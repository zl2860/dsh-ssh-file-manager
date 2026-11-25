// Host-route smoke test: runs the real route handlers against a local temporary
// directory that stands in for the remote host (the fake connection executes
// POSIX commands locally). No SSH, no DSH runtime, no network egress.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

const routes = [];
let server;
let base;
let work;
let home;
let hostRoot;

function run(command) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function* stream(command) {
  const child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
  const queue = [];
  let ended = false;
  let wake = null;
  const notify = () => { if (wake) { const resume = wake; wake = null; resume(); } };
  child.stdout.on('data', (chunk) => { queue.push({ stream: 'stdout', chunk }); notify(); });
  child.stderr.on('data', (chunk) => { queue.push({ stream: 'stderr', chunk }); notify(); });
  child.on('close', (code) => { queue.push({ exitCode: code ?? -1 }); ended = true; notify(); });
  for (;;) {
    if (queue.length > 0) {
      const item = queue.shift();
      yield item;
      if (item.exitCode !== undefined) return;
      continue;
    }
    if (ended) return;
    await new Promise((resolve) => { wake = resolve; });
  }
}

function fakeFs() {
  return {
    async listDir(dir) {
      const names = await readdir(dir);
      return Promise.all(names.map(async (name) => {
        const info = await stat(path.join(dir, name));
        return {
          name,
          type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other',
          size: info.size,
          mtime: Math.floor(info.mtimeMs / 1000),
        };
      }));
    },
    async stat(target) {
      try {
        const info = await stat(target);
        return {
          type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          size: info.size,
          mtime: Math.floor(info.mtimeMs / 1000),
        };
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async readBytes(target, options = {}) {
      const data = await readFile(target);
      const offset = options.offset ?? 0;
      return options.length === undefined ? data.subarray(offset) : data.subarray(offset, offset + options.length);
    },
    async writeFileAtomic(target, data) {
      await writeFile(target, data);
    },
  };
}

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'sshfm-'));
  home = path.join(work, 'home');
  hostRoot = path.join(work, 'srv');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(hostRoot, 'sub'), { recursive: true });
  await writeFile(path.join(hostRoot, 'hello.txt'), 'line one\nline two\n');
  await writeFile(path.join(hostRoot, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 5]));
  await writeFile(path.join(hostRoot, 'sub', 'nested.md'), '# nested\n');

  process.env.DSH_HOME = path.join(work, 'dsh-home');
  const placeholderPath = path.join(process.env.DSH_HOME, 'remote', 'demo', Buffer.from(hostRoot, 'utf8').toString('base64url'));
  await mkdir(placeholderPath, { recursive: true });

  const fs = fakeFs();
  const conn = {
    hostId: 'demo',
    fs: async () => fs,
    exec: run,
    execStream: stream,
  };
  const pool = {
    getHost: (id) => (id === 'demo' ? { id: 'demo', host: 'example.test', user: 'me' } : undefined),
    acquire: async () => conn,
    release: () => {},
  };
  const ctx = {
    sshPool: pool,
    workspaceRegistry: { list: () => [{ id: 'w1', path: placeholderPath, title: 'demo project' }] },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
    effect: (fn) => { fn(); },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => (key === 'ssh' ? { listHosts: () => ({ hosts: { demo: { name: 'Demo host', host: 'example.test', user: 'me', port: 22 } } }) } : undefined),
  };
  apply(ctx);

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes.find((item) => item.path === url.pathname);
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no route');
      return;
    }
    route.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (work) await rm(work, { recursive: true, force: true });
});

async function getJson(pathname, params = {}, headers = {}) {
  const url = new URL(base + pathname);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() };
}

async function postJson(pathname, body) {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('ping reports the plugin version', async () => {
  const { status, body } = await getJson('/x-ssh-files/ping');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value.ready, true);
});

test('sources lists stored hosts and decoded remote workspaces', async () => {
  const { status, body } = await getJson('/x-ssh-files/sources');
  assert.equal(status, 200);
  assert.deepEqual(body.value.hosts, [{ id: 'demo', name: 'Demo host', host: 'example.test', user: 'me', port: 22 }]);
  assert.equal(body.value.workspaces.length, 1);
  assert.equal(body.value.workspaces[0].hostId, 'demo');
  assert.equal(body.value.workspaces[0].remotePath, hostRoot);
  assert.equal(body.value.workspaces[0].title, 'demo project');
});

test('list returns directories first with metadata', async () => {
  const { status, body } = await getJson('/x-ssh-files/list', { hostId: 'demo', path: hostRoot });
  assert.equal(status, 200);
  const names = body.value.entries.map((entry) => entry.name);
  assert.deepEqual(names, ['sub', 'binary.bin', 'hello.txt']);
  assert.equal(body.value.entries[0].type, 'directory');
  assert.equal(body.value.entries[2].type, 'file');
});

test('text preview reads content and flags binary files', async () => {
  const text = await getJson('/x-ssh-files/text', { hostId: 'demo', path: hostRoot + '/hello.txt' });
  assert.equal(text.body.value.text, 'line one\nline two\n');
  assert.equal(text.body.value.binary, false);
  const binary = await getJson('/x-ssh-files/text', { hostId: 'demo', path: hostRoot + '/binary.bin' });
  assert.equal(binary.body.value.binary, true);
});

test('raw serves bytes and honours a bounded range', async () => {
  const full = await fetch(base + '/x-ssh-files/raw?hostId=demo&path=' + encodeURIComponent(hostRoot + '/hello.txt'));
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'line one\nline two\n');
  const range = await fetch(base + '/x-ssh-files/raw?hostId=demo&path=' + encodeURIComponent(hostRoot + '/hello.txt'), {
    headers: { range: 'bytes=0-3' },
  });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'line');
});

test('mkdir / newfile / rename / copy / move / remove', async () => {
  const mkdir = await postJson('/x-ssh-files/mkdir', { hostId: 'demo', dir: hostRoot, name: 'fresh' });
  assert.equal(mkdir.body.ok, true);
  assert.equal((await stat(path.join(hostRoot, 'fresh'))).isDirectory(), true);

  const newfile = await postJson('/x-ssh-files/newfile', { hostId: 'demo', dir: path.join(hostRoot, 'fresh'), name: 'a.txt', content: 'alpha' });
  assert.equal(newfile.body.ok, true);
  assert.equal(await readFile(path.join(hostRoot, 'fresh', 'a.txt'), 'utf8'), 'alpha');

  const rename = await postJson('/x-ssh-files/rename', { hostId: 'demo', path: path.join(hostRoot, 'fresh', 'a.txt'), name: 'b.txt' });
  assert.equal(rename.body.ok, true);
  assert.equal(await readFile(path.join(hostRoot, 'fresh', 'b.txt'), 'utf8'), 'alpha');

  const copy = await postJson('/x-ssh-files/copy', { hostId: 'demo', destDir: path.join(hostRoot, 'sub'), items: [path.join(hostRoot, 'fresh', 'b.txt')] });
  assert.equal(copy.body.ok, true);
  assert.equal(copy.body.value.done.length, 1);
  assert.equal(await readFile(path.join(hostRoot, 'sub', 'b.txt'), 'utf8'), 'alpha');

  const conflict = await postJson('/x-ssh-files/copy', { hostId: 'demo', destDir: path.join(hostRoot, 'sub'), items: [path.join(hostRoot, 'fresh', 'b.txt')] });
  assert.equal(conflict.body.value.failed.length, 1);
  assert.equal(conflict.body.value.failed[0].code, 'exists');

  const move = await postJson('/x-ssh-files/move', { hostId: 'demo', destDir: hostRoot, items: [path.join(hostRoot, 'sub', 'b.txt')] });
  assert.equal(move.body.ok, true);
  assert.equal(await readFile(path.join(hostRoot, 'b.txt'), 'utf8'), 'alpha');

  const remove = await postJson('/x-ssh-files/remove', { hostId: 'demo', paths: [path.join(hostRoot, 'b.txt'), path.join(hostRoot, 'sub', 'b.txt')] });
  assert.equal(remove.body.ok, true);
  assert.equal(remove.body.value.done.length, 2);
  await assert.rejects(stat(path.join(hostRoot, 'b.txt')));
});

test('upload writes bytes and download returns them', async () => {
  const payload = Buffer.from('uploaded content\n');
  const response = await fetch(base + '/x-ssh-files/upload?hostId=demo&dir=' + encodeURIComponent(hostRoot) + '&name=up.txt', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: payload,
  });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(await readFile(path.join(hostRoot, 'up.txt'), 'utf8'), 'uploaded content\n');

  const download = await fetch(base + '/x-ssh-files/download?hostId=demo&dir=' + encodeURIComponent(hostRoot) + '&name=up.txt');
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(await download.text(), 'uploaded content\n');

  const duplicate = await fetch(base + '/x-ssh-files/upload?hostId=demo&dir=' + encodeURIComponent(hostRoot) + '&name=up.txt', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: payload,
  });
  assert.equal(duplicate.status, 409);
});

test('zero-byte files can be uploaded', async () => {
  const response = await fetch(base + '/x-ssh-files/upload?hostId=demo&dir=' + encodeURIComponent(hostRoot) + '&name=empty.txt', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.alloc(0),
  });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal((await stat(path.join(hostRoot, 'empty.txt'))).size, 0);
  const text = await getJson('/x-ssh-files/text', { hostId: 'demo', path: hostRoot + '/empty.txt' });
  assert.equal(text.body.value.text, '');
  assert.equal(text.body.value.binary, false);
});

test('download archives a directory as gzip', async () => {
  const response = await fetch(base + '/x-ssh-files/download?hostId=demo&dir=' + encodeURIComponent(hostRoot) + '&name=sub');
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);
  assert.match(response.headers.get('content-disposition') ?? '', /sub\.tar\.gz/);
});

test('cross-site requests are rejected and relative paths fail', async () => {
  const cross = await getJson('/x-ssh-files/list', { hostId: 'demo', path: hostRoot }, { 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403);
  const relative = await getJson('/x-ssh-files/list', { hostId: 'demo', path: 'relative/dir' });
  assert.equal(relative.status, 400);
  const unknown = await getJson('/x-ssh-files/list', { hostId: 'nope', path: hostRoot });
  assert.equal(unknown.status, 404);
});
