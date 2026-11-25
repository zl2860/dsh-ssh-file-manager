// dsh-ssh-file-manager — Host half.
//
// Serves the remote file-manager routes the Client panel calls:
//   GET  /x-ssh-files/ping
//   GET  /x-ssh-files/sources            stored SSH hosts + remote workspaces
//   GET  /x-ssh-files/home?hostId=       the remote login user's $HOME
//   GET  /x-ssh-files/list?hostId&path
//   GET  /x-ssh-files/stat?hostId&path
//   GET  /x-ssh-files/text?hostId&path   bounded text preview
//   GET  /x-ssh-files/raw?hostId&path    image / PDF bytes (Range support)
//   GET  /x-ssh-files/download?hostId&dir&name  one file, or a tar.gz of the selection
//   POST /x-ssh-files/mkdir | newfile | rename | remove | copy | move
//   POST /x-ssh-files/upload?hostId&dir&name    raw request body
//
// Data plane only: every connection, credential and host-key check stays in
// `dsh-ssh-toolkit`'s pool (ctx.sshPool). The routes reach only hosts the user
// already configured there, and each request names a stored host id plus an
// absolute remote POSIX path — nothing is executed locally.
//
// Request policy: these routes live outside `/api`, so they enforce their own
// policy here — cross-site requests (Sec-Fetch-Site: cross-site, or a
// mismatching Origin) are rejected before touching SSH.
import { posix } from 'node:path';
import {
  RouteError,
  copyInto,
  describeSshError,
  isSafeHostId,
  listEntries,
  makeDirectory,
  moveInto,
  removePath,
  renamePath,
  requireAbsolutePath,
  requireName,
  shellQuote,
  statOf,
  textPreview,
  withConn,
  writeFile,
} from './lib/remote.js';
import { mapLocalToRemote } from './lib/router.js';

export const name = 'dsh-ssh-file-manager';

/** Services this plugin cannot work without; `sshPool` comes from dsh-ssh-toolkit. */
export const inject = ['webServer', 'sshPool', 'workspaceRegistry'];

const BASE = '/x-ssh-files';
const VERSION = '0.1.0';
const MAX_TEXT_BYTES = 1_536_000;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────── HTTP helpers

/** Reject cross-site callers before any SSH work happens. */
function originAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function ok(res, value) {
  sendJson(res, 200, { ok: true, value });
}

/** RFC 5987-safe attachment name. */
function contentDisposition(fileName) {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName);
}

/** Media type for `/raw`; anything that is not an image or PDF is served as text. */
function mediaTypeOf(absolutePath) {
  const dot = absolutePath.lastIndexOf('.');
  const ext = dot < 0 ? '' : absolutePath.slice(dot + 1).toLowerCase();
  const images = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
  };
  if (images[ext]) return { mime: images[ext], headers: {} };
  if (ext === 'svg') {
    return {
      mime: 'image/svg+xml',
      headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" },
    };
  }
  if (ext === 'pdf') return { mime: 'application/pdf', headers: {} };
  return { mime: 'text/plain; charset=utf-8', headers: {} };
}

/** Parse one bounded `bytes=` Range header; null when absent or not usable. */
function parseRange(header, total) {
  if (typeof header !== 'string' || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  let start;
  let end;
  if (startText === '' && endText !== '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? total - 1 : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || start >= total || end < start) return null;
    end = Math.min(end, total - 1);
  }
  return { start, end, length: end - start + 1 };
}

/** Stream one remote command's stdout into the response, honouring backpressure. */
async function pipeCommand(conn, command, res) {
  let closed = false;
  let exitCode = 0;
  let failure = '';
  const onClose = () => {
    closed = true;
  };
  res.on('close', onClose);
  try {
    for await (const item of conn.execStream(command)) {
      if (!item) continue;
      if (item.exitCode !== undefined) {
        exitCode = item.exitCode;
        break;
      }
      if (closed) continue;
      if (item.stream === 'stderr') {
        failure += item.chunk.toString('utf8');
        continue;
      }
      if (item.stream !== 'stdout') continue;
      if (!res.write(item.chunk)) {
        await new Promise((resolve) => {
          const finish = () => {
            res.off('drain', finish);
            res.off('close', finish);
            resolve();
          };
          res.once('drain', finish);
          res.once('close', finish);
        });
      }
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
  if (exitCode !== 0) {
    // Headers are already out; the dispatcher destroys the response so the
    // browser reports a failed transfer instead of a silently short file.
    throw new RouteError('remote', failure.trim() || 'remote command failed with exit code ' + exitCode, 500);
  }
}

/** Read a JSON body with a hard byte cap. */
async function readJsonBody(req) {
  const declared = Number(req.headers['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new RouteError('bad-request', 'request body is too large', 413);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new RouteError('bad-request', 'request body is too large', 413);
    chunks.push(chunk);
  }
  if (total === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RouteError('bad-request', 'request body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError('bad-request', 'request body must be a JSON object');
  }
  return parsed;
}

/** Read a raw upload body with a hard byte cap. */
async function readRawBody(req) {
  const declared = Number(req.headers['content-length'] ?? NaN);
  // A zero-byte file is a valid upload: the body is simply empty.
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw new RouteError('too-large', 'file exceeds the ' + Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) + ' MiB upload limit', 413);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw new RouteError('too-large', 'file exceeds the upload limit', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ──────────────────────────────────────────────────────────────── Host sources

/** Stored hosts from the SSH toolkit (redacted listing; only identity fields are used). */
function storedHosts(ctx) {
  const ssh = typeof ctx.get === 'function' ? ctx.get('ssh') : undefined;
  if (!ssh || typeof ssh.listHosts !== 'function') return [];
  let state;
  try {
    state = ssh.listHosts();
  } catch {
    return [];
  }
  const hosts = state && state.hosts && typeof state.hosts === 'object' ? state.hosts : {};
  const list = [];
  for (const [id, cfg] of Object.entries(hosts)) {
    if (!cfg || typeof cfg !== 'object') continue;
    list.push({
      id,
      name: typeof cfg.name === 'string' && cfg.name.trim().length > 0 ? cfg.name.trim() : id,
      host: typeof cfg.host === 'string' ? cfg.host : '',
      user: typeof cfg.user === 'string' ? cfg.user : '',
      port: Number.isFinite(cfg.port) ? cfg.port : 22,
    });
  }
  return list.sort((left, right) => left.name.localeCompare(right.name));
}

/** Remote workspaces: registry placeholder paths decoded back to host + remote path. */
function remoteWorkspaces(ctx) {
  const registry = ctx.workspaceRegistry;
  if (!registry || typeof registry.list !== 'function') return [];
  let entities;
  try {
    entities = registry.list();
  } catch {
    return [];
  }
  const workspaces = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    const localPath = entity && typeof entity.path === 'string' ? entity.path : '';
    let mapped;
    try {
      mapped = mapLocalToRemote(localPath);
    } catch {
      mapped = null;
    }
    if (!mapped) continue;
    let title = '';
    try {
      title = typeof entity.title === 'string' ? entity.title.trim() : '';
    } catch {
      title = '';
    }
    workspaces.push({
      id: String(entity.id ?? ''),
      title: title || posix.basename(mapped.remotePath) || mapped.remotePath,
      hostId: mapped.hostId,
      remotePath: mapped.remotePath,
    });
  }
  workspaces.sort((left, right) => left.title.localeCompare(right.title));
  return workspaces;
}

// ────────────────────────────────────────────────────────────────────── Routes

/** Build one route table bound to the live Host services. */
function createRoutes(services) {
  const { ctx, pool } = services;
  const query = (url, key) => url.searchParams.get(key) ?? '';
  const hostOf = (url) => {
    const hostId = query(url, 'hostId');
    if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
    return hostId;
  };
  const pathOf = (url, key = 'path') => requireAbsolutePath(query(url, key), key);

  const routes = [
    {
      method: 'GET',
      path: BASE + '/ping',
      async handle(services2, req, res) {
        ok(res, { version: VERSION, ready: true });
      },
    },
    {
      method: 'GET',
      path: BASE + '/sources',
      async handle(services2, req, res) {
        ok(res, { hosts: storedHosts(ctx), workspaces: remoteWorkspaces(ctx) });
      },
    },
    {
      method: 'GET',
      path: BASE + '/home',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const home = await withConn(pool, hostId, async (fs, conn) => {
          const result = await conn.exec('printf %s "$HOME"', { timeoutMs: 15_000 });
          const value = String(result.stdout || '').trim();
          if (result.code !== 0 || !value.startsWith('/')) {
            throw new RouteError('remote', 'could not resolve the remote home directory', 502);
          }
          return value;
        });
        ok(res, { home });
      },
    },
    {
      method: 'GET',
      path: BASE + '/list',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const dir = pathOf(url);
        const listing = await withConn(pool, hostId, (fs) => listEntries(fs, dir, MAX_ENTRIES));
        ok(res, listing);
      },
    },
    {
      method: 'GET',
      path: BASE + '/stat',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const target = pathOf(url);
        const info = await withConn(pool, hostId, (fs) => statOf(fs, target));
        if (info === undefined) throw new RouteError('not-found', 'No such file or directory', 404);
        ok(res, { path: target, ...info });
      },
    },
    {
      method: 'GET',
      path: BASE + '/text',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const target = pathOf(url);
        const preview = await withConn(pool, hostId, (fs) => textPreview(fs, target, MAX_TEXT_BYTES));
        ok(res, { path: target, ...preview });
      },
    },
    {
      method: 'GET',
      path: BASE + '/raw',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const target = pathOf(url);
        const media = mediaTypeOf(target);
        await withConn(pool, hostId, async (fs, conn) => {
          const info = await statOf(fs, target);
          if (info === undefined) throw new RouteError('not-found', 'No such file or directory', 404);
          if (info.type === 'directory') throw new RouteError('is-directory', 'The target is a directory', 400);
          const total = info.size ?? 0;
          const range = parseRange(req.headers.range, total);
          const headers = {
            'content-type': media.mime,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'accept-ranges': 'bytes',
            ...media.headers,
          };
          if (range !== null && range.length <= MAX_RANGE_BYTES) {
            const data = await fs.readBytes(target, { offset: range.start, length: range.length });
            res.writeHead(206, {
              ...headers,
              'content-range': 'bytes ' + range.start + '-' + (range.start + data.length - 1) + '/' + total,
              'content-length': String(data.length),
            });
            res.end(data);
            return;
          }
          res.writeHead(200, { ...headers, 'content-length': String(total) });
          if (total === 0) {
            res.end();
            return;
          }
          await pipeCommand(conn, 'cat -- ' + shellQuote(target), res);
        });
      },
    },
    {
      method: 'GET',
      path: BASE + '/download',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const dir = requireAbsolutePath(query(url, 'dir'), 'dir');
        const names = [];
        for (const raw of url.searchParams.getAll('name')) {
          const name = requireName(raw);
          if (!names.includes(name)) names.push(name);
        }
        if (names.length === 0) throw new RouteError('bad-request', 'name is required');
        if (names.length === 1) {
          const target = posix.join(dir, names[0]);
          const single = await withConn(pool, hostId, async (fs, conn) => {
            const info = await statOf(fs, target);
            if (info === undefined) throw new RouteError('not-found', 'No such file or directory', 404);
            if (info.type === 'directory') return null;
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-length': String(info.size ?? 0),
              'content-disposition': contentDisposition(names[0]),
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            });
            if ((info.size ?? 0) === 0) {
              res.end();
              return true;
            }
            await pipeCommand(conn, 'cat -- ' + shellQuote(target), res);
            return true;
          });
          if (single === true) return;
        }
        // One directory, or several entries: stream a tar.gz built on the remote.
        const archiveName = (names.length === 1 ? names[0] : posix.basename(dir) || 'selection') + '.tar.gz';
        await withConn(pool, hostId, async (fs, conn) => {
          for (const name of names) {
            const info = await statOf(fs, posix.join(dir, name));
            if (info === undefined) throw new RouteError('not-found', '"' + name + '" does not exist', 404);
          }
          const command = 'tar -czf - -C ' + shellQuote(dir) + ' -- ' + names.map(shellQuote).join(' ');
          res.writeHead(200, {
            'content-type': 'application/gzip',
            'content-disposition': contentDisposition(archiveName),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          await pipeCommand(conn, command, res);
        });
      },
    },
    {
      method: 'POST',
      path: BASE + '/mkdir',
      async handle(services2, req, res) {
        const body = await readJsonBody(req);
        const hostId = body.hostId;
        if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
        const dir = requireAbsolutePath(body.dir, 'dir');
        const name = requireName(body.name);
        const target = posix.join(dir, name);
        await withConn(pool, hostId, async (fs, conn) => {
          const info = await statOf(fs, target);
          if (info !== undefined) throw new RouteError('exists', 'A file with that name already exists', 409);
          await makeDirectory(conn, target);
        });
        ok(res, { path: target });
      },
    },
    {
      method: 'POST',
      path: BASE + '/newfile',
      async handle(services2, req, res) {
        const body = await readJsonBody(req);
        const hostId = body.hostId;
        if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
        const dir = requireAbsolutePath(body.dir, 'dir');
        const name = requireName(body.name);
        const content = typeof body.content === 'string' ? body.content : '';
        if (Buffer.byteLength(content, 'utf8') > MAX_BODY_BYTES) {
          throw new RouteError('bad-request', 'initial content is too large', 413);
        }
        const target = posix.join(dir, name);
        await withConn(pool, hostId, async (fs) => {
          const info = await statOf(fs, target);
          if (info !== undefined) throw new RouteError('exists', 'A file with that name already exists', 409);
          await writeFile(fs, target, Buffer.from(content, 'utf8'));
        });
        ok(res, { path: target });
      },
    },
    {
      method: 'POST',
      path: BASE + '/rename',
      async handle(services2, req, res) {
        const body = await readJsonBody(req);
        const hostId = body.hostId;
        if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
        const from = requireAbsolutePath(body.path, 'path');
        const name = requireName(body.name);
        const to = posix.join(posix.dirname(from), name);
        if (to === from) {
          ok(res, { path: from, unchanged: true });
          return;
        }
        await withConn(pool, hostId, (fs, conn) => renamePath(conn, from, to));
        ok(res, { path: to });
      },
    },
    {
      method: 'POST',
      path: BASE + '/remove',
      async handle(services2, req, res) {
        const body = await readJsonBody(req);
        const hostId = body.hostId;
        if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          throw new RouteError('bad-request', 'paths is required');
        }
        const targets = body.paths.map((value, index) => requireAbsolutePath(value, 'paths[' + index + ']'));
        const done = [];
        const failed = [];
        await withConn(pool, hostId, async (fs, conn) => {
          for (const target of targets) {
            try {
              await removePath(conn, target);
              done.push(target);
            } catch (err) {
              const described = describeSshError(err, hostId);
              failed.push({ path: target, code: described.code, message: described.message });
            }
          }
        });
        ok(res, { done, failed });
      },
    },
    {
      method: 'POST',
      path: BASE + '/copy',
      async handle(services2, req, res) {
        await transferInto(req, res, 'copy', copyInto);
      },
    },
    {
      method: 'POST',
      path: BASE + '/move',
      async handle(services2, req, res) {
        await transferInto(req, res, 'move', moveInto);
      },
    },
    {
      method: 'POST',
      path: BASE + '/upload',
      async handle(services2, req, res, url) {
        const hostId = hostOf(url);
        const dir = requireAbsolutePath(query(url, 'dir'), 'dir');
        const name = requireName(query(url, 'name'));
        const overwrite = query(url, 'overwrite') === '1';
        const data = await readRawBody(req);
        const target = posix.join(dir, name);
        await withConn(pool, hostId, async (fs) => {
          const info = await statOf(fs, target);
          if (info !== undefined && !overwrite) {
            throw new RouteError('exists', '"' + name + '" already exists in that directory', 409);
          }
          if (info !== undefined && info.type === 'directory') {
            throw new RouteError('exists', '"' + name + '" is a directory', 409);
          }
          await writeFile(fs, target, data);
        });
        ok(res, { path: target, bytes: data.length });
      },
    },
  ];

  /** Shared copy / move implementation: one host, many sources, one destination directory. */
  async function transferInto(req, res, stage, apply) {
    const body = await readJsonBody(req);
    const hostId = body.hostId;
    if (!isSafeHostId(hostId)) throw new RouteError('bad-request', 'hostId is required');
    const destDir = requireAbsolutePath(body.destDir, 'destDir');
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new RouteError('bad-request', 'items is required');
    }
    const items = body.items.map((value, index) => requireAbsolutePath(value, 'items[' + index + ']'));
    const done = [];
    const failed = [];
    await withConn(pool, hostId, async (fs, conn) => {
      const destination = await statOf(fs, destDir);
      if (destination === undefined) throw new RouteError('not-found', 'The destination directory does not exist', 404);
      if (destination.type !== 'directory') throw new RouteError('not-directory', 'The destination is not a directory', 400);
      for (const item of items) {
        try {
          done.push(await apply(conn, item, destDir));
        } catch (err) {
          const described = describeSshError(err, hostId);
          failed.push({ path: item, code: described.code, message: described.message });
        }
      }
    });
    ok(res, { done, failed });
  }

  return routes;
}

// ───────────────────────────────────────────────────────────────────── Entry

/** Dispatch one registered route under the shared policy and error surface. */
async function dispatch(route, services, req, res) {
  try {
    if (originAllowed(req) === false) {
      sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Cross-site request rejected' });
      return;
    }
    if (req.method !== route.method) {
      res.setHeader('allow', route.method);
      sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'Method not allowed' });
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    await route.handle(services, req, res, url);
  } catch (err) {
    const described = describeSshError(err, 'remote');
    if (res.headersSent) {
      try {
        res.destroy();
      } catch {
        /* already gone */
      }
      return;
    }
    sendJson(res, described.status ?? 500, {
      ok: false,
      code: described.code ?? 'error',
      message: described.message,
    });
  }
}

/**
 * Register the remote file-manager routes.
 * @param ctx - Host context carrying webServer, sshPool and workspaceRegistry.
 */
export function apply(ctx) {
  const services = { ctx, pool: ctx.sshPool };
  const routes = createRoutes(services);
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register({
      kind: 'exact',
      path: route.path,
      handler: (req, res) => dispatch(route, services, req, res),
    }));
    ctx.logger?.info?.('[dsh-ssh-file-manager] registered ' + disposers.length + ' routes under ' + BASE);
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* teardown failures are not actionable */
        }
      }
    };
  }, 'dsh-ssh-file-manager: routes');
}
