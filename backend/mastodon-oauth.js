const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const MASTODON_SCOPES = 'read:accounts read:statuses read:search read:bookmarks write:favourites write:statuses';

function mastodonCanInteract(token, action) {
  try {
    const scopes = new Set(String(JSON.parse(token).scope || '').split(/\s+/));
    const has = scope => scopes.has(scope) || scopes.has(scope.split(':')[0]);
    if (!has('read:search')) return false;
    if (action === 'like') return has('write:favourites');
    if (action === 'comment') return has('write:statuses');
    return !action && has('write:favourites') && has('write:statuses');
  } catch { return false; }
}

function mastodonCanReadStatuses(token) {
  try {
    const scopes = String(JSON.parse(token).scope || '').split(/\s+/);
    return scopes.includes('read') || scopes.includes('read:statuses');
  } catch { return false; }
}

function mastodonOrigin(input) {
  let value = String(input || '').trim();
  if (value.includes('@') && !value.includes('://')) value = value.split('@').pop();
  if (!value.includes('://')) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter your Mastodon server, such as mastodon.social.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !['', '/'].includes(url.pathname) || !url.hostname.includes('.') || net.isIP(url.hostname)
      || /(?:^|\.)(localhost|local|internal|home)$/.test(url.hostname) || url.hostname.endsWith('.')) {
    throw new Error('Enter an HTTPS Mastodon server address without a path or port.');
  }
  return url.origin;
}

// Federated status IDs are local to each server. Keep the source URL as the
// identity, and resolve it on the connected server before using a local ID.
function mastodonPostUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://') || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const authority = value.slice(8).split(/[/?#]/, 1)[0];
    if (url.username || url.password || authority.includes(':')) return null;
    mastodonOrigin(url.origin);
    const match = /^\/@([a-zA-Z0-9_.-]+)\/(\d+)\/?$/.exec(url.pathname)
      || /^\/users\/([a-zA-Z0-9_.-]+)\/statuses\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return null;
    return `${url.origin}/@${match[1]}/${match[2]}`;
  } catch { return null; }
}

function createMastodonService({ resolveAddress, pinnedLookup, request = https.request }) {
  const apps = new Map();
  async function json(origin, path, { form, token, idempotencyKey, includeResponse = false } = {}) {
    origin = mastodonOrigin(origin);
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path) || new URL(path, origin).origin !== origin) throw new Error('Invalid Mastodon API path');
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(idempotencyKey))) throw new Error('Invalid Mastodon request identity');
    const address = await resolveAddress(new URL(origin).hostname);
    const body = form != null ? new URLSearchParams(form).toString() : null;
    return new Promise((resolve, reject) => {
      const req = request(new URL(path, origin), {
        method: body !== null ? 'POST' : 'GET', lookup: pinnedLookup(address), agent: false,
        headers: { Accept: 'application/json', 'User-Agent': 'UFIConnect/1.0',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...(body !== null ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) },
      }, res => {
        let bytes = 0; const chunks = [];
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) { res.destroy(); reject(new Error('Mastodon response is too large')); }
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          // Never follow redirects with an OAuth secret or bearer token.
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error(`Mastodon server returned ${res.statusCode}. Check your server address and try connecting again.`), { status: res.statusCode }));
          try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(includeResponse ? { data, headers: { link: res.headers?.link || '' } } : data); }
          catch { reject(new Error('This server did not return a Mastodon API response.')); }
        });
      });
      const deadline = setTimeout(() => req.destroy(new Error('Mastodon server timed out')), 15000);
      req.on('close', () => clearTimeout(deadline));
      req.on('error', reject);
      req.end(body || undefined);
    });
  }
  async function application(origin, redirectUri) {
    const key = `${origin}|${redirectUri}|${MASTODON_SCOPES}`;
    const cached = apps.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await json(origin, '/api/v1/apps', { form: {
      client_name: 'UFIConnect', redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website: 'https://uficonnect.org',
    } });
    if (!value?.client_id || !value?.client_secret) throw new Error('This server could not register UFIConnect.');
    if (apps.size >= 100) apps.delete(apps.keys().next().value);
    apps.set(key, { value, expires: Date.now() + 3600000 });
    return value;
  }
  return { json, application };
}

function registerMastodonRoutes(app, { authenticate, limit, getUser, callbackUrl, frontendUrl, createState, verifyState, saveToken, service }) {
  const cookieName = 'ufi_mastodon_oauth';
  const cookieOptions = { httpOnly: true, secure: new URL(callbackUrl).protocol === 'https:', sameSite: 'lax', path: '/auth/social/mastodon' };
  app.get('/auth/social/mastodon/start', authenticate, limit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const user = await getUser(req.user.id);
    if (!user) return res.status(401).json({ error: 'Sign in before connecting Mastodon.' });
    if (user.plan === 'business') return res.status(403).json({ error: 'Business accounts use career connections.' });
    try {
      const origin = mastodonOrigin(req.query.server || req.query.handle);
      const credentials = await service.application(origin, callbackUrl);
      // State is encrypted by the existing OAuth state implementation.
      const verifier = crypto.randomBytes(32).toString('base64url');
      const browserNonce = crypto.randomBytes(32).toString('base64url');
      const browserHash = crypto.createHash('sha256').update(browserNonce).digest('hex');
      const state = createState(user.id, 'mastodon', verifier, { origin, clientId: credentials.client_id, clientSecret: credentials.client_secret, browserHash,
        ...(req.query.returnTo === 'command-center' ? { returnTo: 'command-center' } : {}) });
      res.cookie(cookieName, browserNonce, { ...cookieOptions, maxAge: 600000 });
      res.json({ url: `${origin}/oauth/authorize?${new URLSearchParams({
        response_type: 'code', client_id: credentials.client_id, redirect_uri: callbackUrl, scope: MASTODON_SCOPES, state,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      })}` });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/auth/social/mastodon/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const entry = verifyState(req.query.state, 'mastodon');
    const destination = entry?.extra?.returnTo === 'command-center'
      ? `${frontendUrl}/command-center?tab=accounts&` : `${frontendUrl}/connected-accounts?`;
    const fail = reason => res.redirect(`${destination}social_error=mastodon&reason=${reason}`);
    if (!entry?.extra) return fail('invalid_state');
    const browserNonce = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!browserNonce || !/^[a-f0-9]{64}$/.test(entry.extra.browserHash || '')
        || !crypto.timingSafeEqual(crypto.createHash('sha256').update(browserNonce).digest(), Buffer.from(entry.extra.browserHash, 'hex'))) return fail('browser_mismatch');
    res.clearCookie(cookieName, cookieOptions);
    if (req.query.error) return fail('authorization_declined');
    if (typeof req.query.code !== 'string' || !req.query.code) return fail('missing_code');
    try {
      const user = await getUser(entry.userId);
      if (!user || user.plan === 'business') return fail('account_unavailable');
      const { origin, clientId, clientSecret } = entry.extra;
      const result = await service.json(origin, '/oauth/token', { form: {
        grant_type: 'authorization_code', code: req.query.code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: callbackUrl, scope: MASTODON_SCOPES, code_verifier: entry.codeVerifier,
      } });
      if (!result?.access_token) return fail('token_exchange_failed');
      const account = await service.json(origin, '/api/v1/accounts/verify_credentials', { token: result.access_token });
      if (!account?.id) return fail('account_verification_failed');
      await saveToken(entry.userId, 'mastodon', JSON.stringify({ origin, accessToken: result.access_token, accountId: String(account.id), scope: result.scope || MASTODON_SCOPES }));
      res.redirect(`${destination}social_connected=mastodon`);
    } catch { return fail('connection_failed'); }
  });
}

module.exports = { mastodonOrigin, mastodonPostUrl, mastodonCanReadStatuses, mastodonCanInteract, MASTODON_SCOPES, createMastodonService, registerMastodonRoutes };
