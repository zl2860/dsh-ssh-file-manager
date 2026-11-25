// Remote filesystem primitives for the SSH file-manager routes.
//
// Everything here runs on the Host process and talks to the remote machine
// through the connection pool owned by `dsh-ssh-toolkit` (ctx.sshPool). The
// panel never sees credentials: it only names a stored host id and an absolute
// POSIX path, and this module turns that into SFTP / exec calls.
//
// `conn.fs()` returns either the SFTP wrapper or the exec fallback
// (`dsh-ssh-toolkit/src/ssh/exec-fs.js`); both expose stat / readBytes /
// writeFileAtomic. Operations with no shared wrapper method (mkdir, rename,
// recursive copy, recursive remove, streaming) go through `conn.exec` /
// `conn.execStream` with POSIX tools, which the toolkit already requires on the
// remote (Linux or macOS, `sshd` only).
import { posix } from 'node:path';

/** One expected failure with a wire-safe code and an HTTP status. */
export class RouteError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    this.status = status;
  }
}

/** Quote one argument for the remote POSIX shell. */
export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/** A host id must be one safe path segment (same rule the toolkit uses). */
export function isSafeHostId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (id === '.' || id === '..') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

/** Require an absolute POSIX path without NUL bytes; normalized, never empty. */
export function requireAbsolutePath(value, field = 'path') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RouteError('bad-request', field + ' is required');
  }
  if (value.includes('\u0000')) throw new RouteError('bad-request', field + ' contains a NUL byte');
  if (!value.startsWith('/')) throw new RouteError('bad-request', field + ' must be an absolute path');
  const normalized = posix.normalize(value);
  if (!normalized.startsWith('/') || normalized.length === 0) {
    throw new RouteError('bad-request', field + ' is not a valid path');
  }
  return normalized;
}

/** Require one file name (no separators, no traversal, no control bytes). */
export function requireName(value) {
  if (typeof value !== 'string') throw new RouteError('bad-request', 'name is required');
  const name = value.trim();
  if (name.length === 0) throw new RouteError('bad-request', 'name is empty');
  if (name.length > 255) throw new RouteError('bad-request', 'name is longer than 255 bytes');
  if (name === '.' || name === '..') throw new RouteError('bad-request', 'name is not allowed');
  if (/[/\\\u0000-\u001f]/u.test(name)) {
    throw new RouteError('bad-request', 'name must not contain a path separator or control character');
  }
  return name;
}

/** Path metadata in the vocabulary the panel renders. */
export function normalizeType(type) {
  if (type === 'dir' || type === 'directory') return 'directory';
  if (type === 'file') return 'file';
  if (type === 'link' || type === 'symlink') return 'link';
  return 'other';
}

/** Directory-first, case-insensitive name order. */
export function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftDir = left.type === 'directory' ? 0 : 1;
    const rightDir = right.type === 'directory' ? 0 : 1;
    if (leftDir !== rightDir) return leftDir - rightDir;
    const byName = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    return byName !== 0 ? byName : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/** Run one operation on a pooled connection, releasing the slot afterwards. */
export async function withConn(pool, hostId, fn) {
  if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is not a valid host id');
  const cfg = pool.getHost(hostId);
  if (!cfg || typeof cfg !== 'object') {
    throw new RouteError('unknown-host', 'SSH host "' + hostId + '" is not configured; add it under Settings → SSH connections', 404);
  }
  let conn;
  try {
    conn = await pool.acquire({ ...cfg, id: hostId });
  } catch (err) {
    throw describeSshError(err, hostId);
  }
  try {
    const fs = await conn.fs();
    return await fn(fs, conn);
  } finally {
    pool.release(conn);
  }
}

/** Turn pool / SSH failures into a route error with an actionable message. */
export function describeSshError(err, hostId) {
  if (err instanceof RouteError) return err;
  if (err && err.isHostKeyUnknown) {
    return new RouteError(
      'host-key-unknown',
      'The SSH host key for "' + hostId + '" is not trusted yet. Open Settings → SSH connections, test the connection and confirm the fingerprint (' + String(err.fingerprint ?? '') + ').',
      409,
    );
  }
  const stage = err && typeof err.stage === 'string' ? err.stage : '';
  if (stage === 'connect' || stage === 'not-connected' || stage === 'known-hosts' || stage === 'sftp-open' || stage === 'proxy-jump') {
    return new RouteError('connect', 'SSH connection to "' + hostId + '" failed: ' + (err.message ?? String(err)), 502);
  }
  if (err && err.code === 'ENOENT') return new RouteError('not-found', 'No such file or directory', 404);
  return new RouteError('remote', err && err.message ? String(err.message) : String(err), 500);
}

/** Run a remote command and require exit code 0. */
export async function execChecked(conn, command, stage, timeoutMs = 60_000) {
  let result;
  try {
    result = await conn.exec(command, { timeoutMs });
  } catch (err) {
    throw describeSshError(err, conn.hostId);
  }
  if (result.code !== 0) {
    const detail = String(result.stderr || '').trim() || 'exit code ' + result.code;
    throw new RouteError(stage, detail, 500);
  }
  return result;
}

/** Remote metadata, or undefined when the target does not exist. */
export async function statOf(fs, absolutePath) {
  let info;
  try {
    info = await fs.stat(absolutePath);
  } catch (err) {
    throw describeSshError(err, 'remote');
  }
  if (info === undefined || info === null) return undefined;
  return {
    type: normalizeType(info.type),
    size: typeof info.size === 'number' ? info.size : undefined,
    mtime: typeof info.mtime === 'number' ? info.mtime : undefined,
  };
}

/** One directory's entries, directory-first and name-sorted. */
export async function listEntries(fs, absolutePath, maxEntries) {
  let raw;
  try {
    raw = await fs.listDir(absolutePath);
  } catch (err) {
    throw describeSshError(err, 'remote');
  }
  const entries = (Array.isArray(raw) ? raw : []).map((entry) => ({
    name: String(entry.name),
    type: normalizeType(entry.type),
    ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    ...(typeof entry.mtime === 'number' ? { mtime: entry.mtime } : {}),
  }));
  const sorted = sortEntries(entries);
  return {
    path: absolutePath,
    parent: absolutePath === '/' ? '/' : posix.dirname(absolutePath),
    entries: sorted.slice(0, maxEntries),
    truncated: sorted.length > maxEntries,
  };
}

/** Read a bounded head of a text file and classify it. */
export async function textPreview(fs, absolutePath, maxBytes) {
  const info = await statOf(fs, absolutePath);
  if (info === undefined) throw new RouteError('not-found', 'No such file or directory', 404);
  if (info.type === 'directory') throw new RouteError('is-directory', 'The target is a directory', 400);
  const size = info.size ?? 0;
  const length = Math.min(size, maxBytes);
  let buffer;
  try {
    buffer = await fs.readBytes(absolutePath, { offset: 0, length });
  } catch (err) {
    throw describeSshError(err, 'remote');
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));
  const binary = head.includes(0);
  return {
    size,
    mtime: info.mtime,
    readBytes: buffer.length,
    truncated: size > buffer.length,
    binary,
    text: binary ? '' : buffer.toString('utf8'),
  };
}

/** Write one file atomically (temp file + rename on the remote side). */
export async function writeFile(fs, absolutePath, data) {
  try {
    await fs.writeFileAtomic(absolutePath, data);
  } catch (err) {
    throw describeSshError(err, 'remote');
  }
}

/** Create a directory and any missing parents. */
export async function makeDirectory(conn, absolutePath) {
  await execChecked(conn, 'mkdir -p -- ' + shellQuote(absolutePath), 'mkdir');
  return absolutePath;
}

/** Rename inside the same host; refuses to clobber an existing target. */
export async function renamePath(conn, from, to) {
  const fs = await conn.fs();
  const existing = await statOf(fs, to);
  if (existing !== undefined) throw new RouteError('exists', 'A file with that name already exists', 409);
  await execChecked(conn, 'mv -- ' + shellQuote(from) + ' ' + shellQuote(to), 'rename');
  return to;
}

/** Recursively remove one path. `/` is refused outright. */
export async function removePath(conn, absolutePath) {
  if (absolutePath === '/') throw new RouteError('bad-request', 'Refusing to delete /', 400);
  await execChecked(conn, 'rm -rf -- ' + shellQuote(absolutePath), 'remove');
}

/** Copy one entry into a directory; refuses to overwrite. */
export async function copyInto(conn, source, destinationDirectory) {
  const fs = await conn.fs();
  const target = posix.join(destinationDirectory, posix.basename(source));
  if (target === source) throw new RouteError('exists', 'The destination is the source itself', 409);
  if (await statOf(fs, target) !== undefined) {
    throw new RouteError('exists', '"' + posix.basename(source) + '" already exists in the destination', 409);
  }
  await execChecked(conn, 'cp -a -- ' + shellQuote(source) + ' ' + shellQuote(destinationDirectory + '/'), 'copy', 180_000);
  return target;
}

/** Move one entry into a directory; refuses to overwrite. */
export async function moveInto(conn, source, destinationDirectory) {
  const fs = await conn.fs();
  const target = posix.join(destinationDirectory, posix.basename(source));
  if (target === source) throw new RouteError('exists', 'The destination is the source itself', 409);
  if (await statOf(fs, target) !== undefined) {
    throw new RouteError('exists', '"' + posix.basename(source) + '" already exists in the destination', 409);
  }
  await execChecked(conn, 'mv -- ' + shellQuote(source) + ' ' + shellQuote(destinationDirectory + '/'), 'move', 180_000);
  return target;
}
