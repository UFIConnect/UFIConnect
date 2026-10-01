import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { createLocalVaultVpn } from './local-vault-vpn.mjs';
import { createLocalReviewSamples } from './local-review-samples.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// This separate launcher serves a synthetic local account. It is never mounted
// in the production API and never connects to production data or credentials.
export async function createVaultPreview({ port = 4187, projectRoot = root, vpn = createLocalVaultVpn(), samples = false, officeOrigin = null } = {}) {
  if (officeOrigin !== null && officeOrigin !== 'http://127.0.0.1:4174') throw new Error('Only the local Office may embed this preview.');
  const app = await createAppHarness({ env: { CREATOR_ANALYTICS_LOCAL_PREVIEW: 'true' } });
  const userId = 'vault-local-review';
  app.seedUser(member(userId, { name: samples ? 'Your local preview · Sample data' : 'Your local preview', plan: 'pro',
    ...(samples ? { joinedGroups: ['local-review-builders'] } : {}) }));
  const sampleFeed = samples ? createLocalReviewSamples() : null;
  if (samples) app.groups.push({ id: 'local-review-builders', name: 'Local sample builders', description: 'Sample group for local review only.', memberIds: [userId], creatorId: userId, visibility: 'public' });
  const csrfToken = randomBytes(32).toString('hex');
  let listeningPort = port;
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  function validRequest(req, pathname) {
    const hosts = new Set([`localhost:${listeningPort}`, `127.0.0.1:${listeningPort}`]);
    if (!hosts.has(req.headers.host)) return false;
    let fromOffice = false;
    try { fromOffice = Boolean(officeOrigin && new URL(req.headers.referer).origin === officeOrigin); } catch {}
    const officeNavigation = fromOffice && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate'
      && req.headers['sec-fetch-dest'] === 'iframe' && !pathname.startsWith('/api/') && !pathname.startsWith('/__vault/');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && !officeNavigation) return false;
    const publicNavigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate'
      && req.headers['sec-fetch-dest'] === 'document' && !pathname.startsWith('/api/') && !pathname.startsWith('/__vault/');
    return publicNavigation || officeNavigation || !req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
  }
  const plugin = {
    name: 'vault-local-review-only',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          let requestUrl, pathname;
          try { requestUrl = new URL(req.url, 'http://localhost'); pathname = requestUrl.pathname; }
          catch { return send(res, 400, { error: 'Invalid local request URL.' }); }
          if (!validRequest(req, pathname)) return send(res, 403, { error: 'Local preview requests must come from this browser origin.' });
          if (pathname === '/api/auth/session' && req.method === 'GET') {
            const { data: profile } = await app.request('/profile', { userId });
            return send(res, 200, { token: app.token(userId), profile });
          }
          if (sampleFeed && req.method === 'GET') {
            const sample = sampleFeed.read(requestUrl, `http://${req.headers.host}`);
            if (sample) return send(res, 200, sample);
          }
          if (sampleFeed && req.method === 'POST' && ['/api/command-center/cross-post', '/api/social/interactions'].includes(pathname)) {
            return send(res, 503, { error: 'External publishing is unavailable in this local sample preview. No post or interaction was sent.' });
          }
          if (!pathname.startsWith('/__vault/')) return next();
          if (req.method === 'GET' && pathname === '/__vault/session') return send(res, 200, { csrfToken });
          if (req.method === 'GET' && pathname === '/__vault/vpn/status') return send(res, 200, await vpn.status());
          if (req.method !== 'POST' || !['/__vault/vpn/connect', '/__vault/vpn/disconnect'].includes(pathname)) return send(res, 404, { error: 'Unknown local action.' });
          const supplied = Buffer.from(String(req.headers['x-vault-csrf'] || ''));
          const expected = Buffer.from(csrfToken);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Reload the local preview before connecting.' });
          if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON is required.' });
          let body = '';
          for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 2048) return send(res, 413, { error: 'Request is too large.' }); }
          let value; try { value = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid request.' }); }
          if (typeof value?.profileId !== 'string' || value.profileId.length > 500) return send(res, 400, { error: 'Select a configured VPN connection.' });
          const result = pathname.endsWith('/disconnect') ? await vpn.disconnect(value.profileId) : await vpn.connect(value.profileId);
          return send(res, 200, result);
        } catch (error) {
          return send(res, Number.isInteger(error?.status) ? error.status : 503,
            { error: error?.code ? error.message : 'The local service is unavailable.', code: error?.code || 'LOCAL_SERVICE_UNAVAILABLE' });
        }
      });
    },
  };
  const server = await createServer({ root: path.join(projectRoot, 'web'), configFile: path.join(projectRoot, 'web/vite.config.js'), envDir: false,
    plugins: [plugin], define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify(''),
      'import.meta.env.VITE_VAULT_LOCAL_PREVIEW': JSON.stringify('true'),
      'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
    server: { host: '127.0.0.1', port, strictPort: true, cors: false, allowedHosts: ['localhost', '127.0.0.1'],
      headers: { ...(officeOrigin ? {} : { 'X-Frame-Options': 'DENY' }), 'Content-Security-Policy': `frame-ancestors ${officeOrigin || "'none'"}; form-action 'self'; base-uri 'self'`, 'Referrer-Policy': 'strict-origin-when-cross-origin' },
      proxy: { '/api': { target: app.base, rewrite: url => url.replace(/^\/api/, '') } } } });
  try { await server.listen(); } catch (error) { await app.close(); throw error; }
  listeningPort = server.httpServer.address().port;
  return { url: `http://localhost:${listeningPort}`, close: async () => { await server.close(); await app.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT === undefined ? 4187 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const samples = process.argv.includes('--samples');
  const preview = await createVaultPreview({ port, samples });
  console.log(`Your Vault local review: ${preview.url}/vault`);
  console.log('Synthetic local account; vault passwords remain encrypted in this browser. No production connection.');
  if (samples) console.log(`Sample feed: ${preview.url}/ · Jobs: ${preview.url}/opportunities · Videos: ${preview.url}/videos · Music: ${preview.url}/music. Sample data only; external publishing is disabled.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { preview.close().finally(() => process.exit()); });
}
