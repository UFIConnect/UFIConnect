import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSION = /\.(?:[cm]?js|jsx|tsx?|css|scss|json|html|svg|txt|md|xml|webmanifest|vtt)$/i;
const SENSITIVE_NAME = /(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?|private[-_]?keys?)(?:[._-]|$)/i;

function failure(status, message, code = 'invalid_request') {
  return Object.assign(new Error(message), { status, code });
}

function allowedPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':')) return false;
  const segments = value.split('/');
  if (segments.some(segment => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(segment)
    || SENSITIVE_NAME.test(segment))) return false;
  return (value === 'web/index.html' || value.startsWith('web/src/') || value.startsWith('web/public/'))
    && TEXT_EXTENSION.test(value);
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function decode(buffer) {
  if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) {
    throw failure(413, 'Only text files up to 1 MB can be edited.', 'unsupported_file');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw failure(415, 'The file must contain UTF-8 text.', 'unsupported_file');
  }
}

async function readBody(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_FILE_BYTES * 2) throw failure(413, 'The save request is too large.', 'too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'Send a valid JSON save request.'); }
}

export function createLocalWebMiddleware({
  root = DEFAULT_ROOT,
  officeUrl = 'http://127.0.0.1:4174',
  previewUrl = 'http://127.0.0.1:4173',
  phoneAccess,
} = {}) {
  const expected = new URL(officeUrl);
  if (expected.hostname !== '127.0.0.1' || expected.protocol !== 'http:') {
    throw new Error('The local web editor must use a loopback HTTP address.');
  }
  const canonicalRoot = realpath(root);
  const saves = new Map();

  async function resolveFile(filePath) {
    if (!allowedPath(filePath)) throw failure(400, 'Choose an existing website source or public text file.', 'invalid_path');
    const base = await canonicalRoot;
    let target = base;
    for (const segment of filePath.split('/')) {
      target = path.join(target, segment);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw failure(403, 'Symbolic links cannot be edited.', 'invalid_path');
    }
    const resolved = await realpath(target);
    if (!within(base, resolved) || resolved !== target) {
      throw failure(403, 'The file must stay inside the local website.', 'invalid_path');
    }
    const info = await lstat(resolved);
    if (!info.isFile() || info.nlink > 1) throw failure(403, 'Only regular website files can be edited.', 'invalid_path');
    if (info.size > MAX_FILE_BYTES) throw failure(413, 'Only text files up to 1 MB can be edited.', 'unsupported_file');
    return resolved;
  }

  async function fileResponse(filePath) {
    const resolved = await resolveFile(filePath);
    const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const bytes = await handle.readFile();
      return { path: filePath, content: decode(bytes), revision: digest(bytes) };
    } finally { await handle.close(); }
  }

  async function files() {
    const base = await canonicalRoot;
    const results = [];
    async function walk(relative) {
      const target = path.join(base, relative);
      let entries;
      try {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isDirectory()) return;
        entries = await readdir(target, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || SENSITIVE_NAME.test(entry.name)) continue;
        const next = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await walk(next);
        else if (entry.isFile() && allowedPath(next)) {
          try { await resolveFile(next); results.push({ path: next }); }
          catch (error) { if (!error.status && error.code !== 'ENOENT') throw error; }
        }
      }
    }
    // Check the web ancestor before walking, so a replaced web directory cannot
    // make even the file list traverse outside the workspace.
    const webInfo = await lstat(path.join(base, 'web'));
    if (webInfo.isSymbolicLink() || !webInfo.isDirectory()) throw failure(403, 'The website directory is not a regular directory.', 'invalid_path');
    await walk('web/src');
    await walk('web/public');
    try { await resolveFile('web/index.html'); results.push({ path: 'web/index.html' }); }
    catch (error) { if (!error.status && error.code !== 'ENOENT') throw error; }
    return results.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function save(filePath, body) {
    if (!body || body.path !== filePath || typeof body.content !== 'string'
      || !/^[a-f0-9]{64}$/.test(body.expectedRevision || '')) {
      throw failure(400, 'A save requires the file path, full content, and expected revision.');
    }
    const bytes = Buffer.from(body.content, 'utf8');
    decode(bytes);
    const prior = saves.get(filePath) || Promise.resolve();
    const pending = prior.catch(() => {}).then(async () => {
      const resolved = await resolveFile(filePath);
      const handle = await open(resolved, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink > 1) throw failure(403, 'Only regular website files can be edited.', 'invalid_path');
        const current = await handle.readFile();
        if (digest(current) !== body.expectedRevision) {
          throw failure(409, 'This file changed since it was loaded. Reload it before saving.', 'stale_revision');
        }
        // Recheck the pathname immediately before modifying the opened file.
        await resolveFile(filePath);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
          if (bytesWritten === 0) throw new Error('The file write did not complete.');
          offset += bytesWritten;
        }
        await handle.truncate(bytes.length);
        await handle.sync();
        return { path: filePath, content: body.content, revision: digest(bytes) };
      } finally { await handle.close(); }
    });
    saves.set(filePath, pending);
    try { return await pending; }
    finally { if (saves.get(filePath) === pending) saves.delete(filePath); }
  }

  return async function localWebMiddleware(request, response, next) {
    let url;
    try { url = new URL(request.url, officeUrl); }
    catch { return next(); }
    if (!url.pathname.startsWith('/__local-web/')) return next();
    const send = (status, payload) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      response.end(JSON.stringify(payload));
    };
    try {
      if (request.headers.host !== expected.host
        || (request.headers.origin && request.headers.origin !== expected.origin)) {
        throw failure(403, 'Open the editor from the local Office address.', 'forbidden_origin');
      }
      if (request.method === 'GET' && url.pathname === '/__local-web/status') {
        return send(200, { previewUrl, officeUrl, writeHeader: 'X-Local-Web-Editor', phone: phoneAccess?.getStatus() || { state: 'unavailable' } });
      }
      if (url.pathname === '/__local-web/phone' && request.method === 'POST') {
        if (request.headers.origin !== expected.origin || request.headers['x-local-web-editor'] !== '1') throw failure(403, 'Manage phone access from the local Office editor.', 'forbidden_origin');
        if (!phoneAccess) throw failure(503, 'Restart with npm run office:release-local to enable phone access.');
        const body = await readBody(request);
        if (body.action === 'stop') { await phoneAccess.stop(); return send(200, phoneAccess.getStatus()); }
        if (body.action !== 'start') throw failure(400, 'Choose start or stop.');
        try { return send(200, await phoneAccess.start()); } catch (error) { throw failure(503, error.message); }
      }
      if (request.method === 'GET' && url.pathname === '/__local-web/files') {
        return send(200, { files: await files() });
      }
      if (url.pathname === '/__local-web/file') {
        const filePath = url.searchParams.get('path');
        if (request.method === 'GET') return send(200, await fileResponse(filePath));
        if (request.method === 'PUT') {
          if (request.headers.origin !== expected.origin || request.headers['x-local-web-editor'] !== '1') {
            throw failure(403, 'Save files from the local Office editor.', 'forbidden_origin');
          }
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
            throw failure(415, 'Save requests must use application/json.', 'unsupported_content_type');
          }
          return send(200, await save(filePath, await readBody(request)));
        }
      }
      throw failure(404, 'Local editor endpoint not found.', 'not_found');
    } catch (error) {
      if (error.code === 'ENOENT') return send(404, { error: 'The file no longer exists.', code: 'not_found' });
      send(error.status || 500, {
        error: error.status ? error.message : 'The local file could not be accessed.',
        code: error.status ? error.code : 'local_file_error',
      });
    }
  };
}

export function localWebWorkbench({ mode, ...options } = {}) {
  return {
    name: 'local-web-workbench',
    apply: 'serve',
    configureServer(server) {
      if (mode === 'release-local') server.middlewares.use(createLocalWebMiddleware(options));
    },
  };
}
