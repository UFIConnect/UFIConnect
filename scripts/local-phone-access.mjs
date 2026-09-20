import { createServer, request as proxyRequest } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const COOKIE = 'ufi_local_phone';
const hash = text => createHash('sha256').update(text).digest();
const pairingPage = () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to local UFIConnect</title><style>body{margin:0;background:#0a1220;color:#e2e8f0;font:16px system-ui;padding:24px}main{max-width:420px;margin:10vh auto}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border-radius:8px;border:1px solid #496179;background:#162b43;color:inherit;font:inherit}button{background:#2563eb}p{line-height:1.6;color:#afc4d9}</style></head><body><main><h1>Connect your phone</h1><p>Enter the connection code shown in Local web on your computer. The computer must stay running.</p><form method="post" action="/__phone/pair"><label for="code">Connection code</label><input id="code" name="code" type="password" autocomplete="off" required maxlength="64"><button>Connect</button></form></main></body></html>`;

export function createPhoneGateway({ target, code, kind = 'office', phoneStatus = () => ({}) }) {
  const upstream = new URL(target);
  if (upstream.hostname !== '127.0.0.1' || upstream.protocol !== 'http:') throw new Error('Phone gateway targets must be loopback services.');
  const codeHash = hash(code);
  const sessions = new Map();
  let origin = '', attempts = 0, attemptWindow = 0;
  const authenticated = req => {
    const cookie = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const now = Date.now();
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
    return cookie && sessions.has(cookie);
  };
  const validOrigin = req => origin && req.headers.host === new URL(origin).host
    && (!req.headers.origin || req.headers.origin === origin);
  const commonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
  const respond = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { ...commonHeaders, 'Content-Type': `${type}; charset=utf-8` });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    if (!validOrigin(req)) return respond(res, 403, { error: 'Use this computer’s secure phone link.' });
    if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return respond(res, 400, { error: 'Invalid request path.' });
    const url = new URL(req.url, origin);
    let decodedPath;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { return respond(res, 400, { error: 'Invalid request path.' }); }
    if (url.pathname === '/__phone/pair' && req.method === 'POST') {
      if (req.headers.origin !== origin || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return respond(res, 403, { error: 'Use the connection form.' });
      if (Date.now() - attemptWindow > 60000) { attemptWindow = Date.now(); attempts = 0; }
      if (++attempts > 10) return respond(res, 429, { error: 'Wait a minute before trying again.' });
      let body = '';
      try { for await (const part of req) { body += part; if (body.length > 4096) return respond(res, 413, { error: 'Connection request is too large.' }); } }
      catch { return respond(res, 400, { error: 'Connection request interrupted.' }); }
      const entered = new URLSearchParams(body).get('code') || '';
      if (!timingSafeEqual(hash(entered.trim()), codeHash)) return respond(res, 403, { error: 'That connection code is incorrect. Return and try again.' });
      const session = randomBytes(32).toString('hex');
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
      sessions.set(session, Date.now() + 8 * 3600000);
      res.writeHead(303, { ...commonHeaders, Location: kind === 'office' ? '/#local-web' : '/', 'Set-Cookie': `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
      return res.end();
    }
    if (!authenticated(req)) {
      if (req.method === 'GET' && url.pathname === '/') return respond(res, 200, pairingPage(), 'text/html');
      return respond(res, 401, { error: 'Connect this phone first.' });
    }
    if (url.pathname === '/__phone/disconnect' && req.method === 'POST') {
      if (req.headers.origin !== origin) return respond(res, 403, { error: 'Origin not allowed.' });
      const session = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      sessions.delete(session);
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
      return respond(res, 200, { disconnected: true });
    }
    // Separate HTTPS origins keep the website preview out of the file editor.
    if (kind === 'web' && url.pathname.startsWith('/__local-web')) return respond(res, 404, { error: 'Not found.' });
    if (kind === 'office' && url.pathname === '/__local-web/status' && req.method === 'GET') {
      const phone = phoneStatus();
      return respond(res, 200, { previewUrl: phone.previewUrl, phone: { url: origin, remote: true }, writeHeader: 'X-Local-Web-Editor' });
    }
    if (url.pathname.startsWith('/__local-web/phone')) return respond(res, 403, { error: 'Manage phone connections on your computer.' });
    if (decodedPath.startsWith('/@fs/') || /\/(?:\.git|\.cache|\.env)(?:[/.]|$)/.test(decodedPath)) return respond(res, 403, { error: 'This file is not available on the phone connection.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) return respond(res, 403, { error: 'Origin not allowed.' });
    const headers = { ...req.headers, host: upstream.host };
    if (headers.origin) headers.origin = upstream.origin;
    delete headers['x-forwarded-host']; delete headers['x-forwarded-proto']; delete headers['cf-connecting-ip'];
    headers.cookie = String(headers.cookie || '').split(';').filter(item => !item.trim().startsWith(`${COOKIE}=`)).join(';');
    const proxy = proxyRequest({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode, { ...response.headers, 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
      response.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) respond(res, 502, { error: 'The local workspace is not running.' }); else res.destroy(); });
    req.on('aborted', () => proxy.destroy()); req.pipe(proxy);
  });
  // Preview refresh is explicit on phones; do not expose Vite's development socket.
  server.on('upgrade', (_req, socket) => socket.destroy());
  return { server, setOrigin(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS phone origin.'); origin = url.origin; } };
}

export function createPhoneAccess({ root, executable = process.env.CLOUDFLARED_PATH || path.join(root, '.cache/tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared') }) {
  let status = { state: 'off' }, pending, code;
  const children = [], gateways = [];
  const getStatus = () => ({ ...status, ...(status.state === 'ready' ? { code } : {}) });
  async function stop() {
    children.splice(0).forEach(child => child.kill());
    await Promise.all(gateways.splice(0).map(gateway => { gateway.server.closeAllConnections(); return new Promise(resolve => gateway.server.close(resolve)); }));
    status = { state: 'off' }; code = undefined;
  }
  async function tunnel(kind, target) {
    const gateway = createPhoneGateway({ target, code, kind, phoneStatus: () => status });
    gateways.push(gateway);
    await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(0, '127.0.0.1', resolve); });
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${gateway.server.address().port}`], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let settled = false, log = '';
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Phone connection timed out. Try again.')); } }, 45000);
      child.once('error', () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('Install cloudflared or set CLOUDFLARED_PATH, then retry.')); } });
      child.once('exit', () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('Phone connection stopped before it was ready.')); } else if (children.includes(child) && status.state === 'ready') status = { state: 'error', error: 'Phone connection stopped. Restart it on your computer.' }; });
      const read = chunk => {
        log = (log + chunk.toString()).slice(-10000);
        const url = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
        if (url && !settled) { settled = true; clearTimeout(timer); gateway.setOrigin(url); resolve(url); }
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
    });
  }
  const start = () => {
    if (pending) return pending;
    if (status.state === 'ready') return Promise.resolve(getStatus());
    pending = (async () => {
      await stop(); status = { state: 'starting' }; code = randomBytes(12).toString('hex');
      try {
        const [url, previewUrl] = await Promise.all([tunnel('office', 'http://127.0.0.1:4174'), tunnel('web', 'http://127.0.0.1:4173')]);
        status = { state: 'ready', url, previewUrl }; return getStatus();
      } catch (error) { await stop(); status = { state: 'error', error: error.message }; throw error; }
      finally { pending = undefined; }
    })();
    return pending;
  };
  return { start, stop, getStatus };
}
