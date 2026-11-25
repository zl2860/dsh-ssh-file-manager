// Placeholder-directory ↔ remote-path routing.
//
// dsh-ssh-toolkit represents a remote workspace as a local placeholder
// directory: <DSH_SSH_REMOTE_ROOT | $DSH_HOME/remote | ~/.dsh/remote>/<hostId>/<base64url(remote path)>.
// This module is a verbatim, dependency-free copy of the toolkit's
// `src/workspace/router.js` decoding half, so the panel can list remote
// workspaces from the workspace registry without importing another plugin's
// internals. The encoding is checked to round-trip, exactly like the original.
import os from 'node:os';
import path from 'node:path';

/** Placeholder root used by the SSH toolkit (same precedence). */
export function remoteRoot(env = process.env) {
  if (env && env.DSH_SSH_REMOTE_ROOT) return path.resolve(String(env.DSH_SSH_REMOTE_ROOT));
  const dshHome = env && env.DSH_HOME ? String(env.DSH_HOME) : path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'remote');
}

/** A host id must be a safe single path segment. */
export function isValidHostId(hostId) {
  if (typeof hostId !== 'string' || hostId.length === 0) return false;
  if (hostId === '.' || hostId === '..') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(hostId);
}

/** Absolute remote path → one base64url segment. */
export function encodeRemotePath(remotePath) {
  return Buffer.from(String(remotePath), 'utf8').toString('base64url');
}

/** base64url → original string, or null when it is not a canonical encoding. */
export function decodeRemotePath(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  let text;
  try {
    text = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (encodeRemotePath(text) !== encoded) return null;
  return text;
}

/** Local placeholder path → { hostId, remotePath } | null. */
export function mapLocalToRemote(localPath, env) {
  if (typeof localPath !== 'string' || localPath.length === 0) return null;
  const root = remoteRoot(env);
  const rel = path.relative(root, localPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  if (segments.length !== 2) return null;
  const hostId = segments[0];
  const encoded = segments[1];
  if (!isValidHostId(hostId)) return null;
  const remotePath = decodeRemotePath(encoded);
  if (remotePath === null) return null;
  if (!path.isAbsolute(remotePath) || !remotePath.startsWith('/')) return null;
  return { hostId, remotePath };
}
