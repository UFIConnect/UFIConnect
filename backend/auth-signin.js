'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { SESSION_TTL_SECONDS } = require('./auth-security');
const { createSessionCookie } = require('./web-connection-security');

const PREFIX = 'ufi_signin_';
const PHONE_ALIAS_DOMAIN = 'identity.uficonnect.invalid';
const PUBLIC_FAILURE_CODES = new Set(['failed','cancelled','invalid_flow','expired','account_exists','account_missing','unavailable','browser_binding','rate_limited','phone_delivery_unavailable']);
const PROVIDER_FAILURE_CODES = new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','server_error','temporarily_unavailable']);
const IDENTITY_FAILURE_CODES = new Set(['ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWS_INVALID','ERR_JWT_INVALID','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JWKS_NO_MATCHING_KEY','ERR_JWKS_MULTIPLE_MATCHING_KEYS','ERR_JWKS_TIMEOUT','ERR_JWKS_INVALID']);
const FAILURE_STAGES = new Set(['flow','binding','token','identity','account','session']);
const SIGNIN_SCHEMA = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_is_placeholder BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS auth_signin_flows (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('google','apple','phone')),
    client TEXT NOT NULL CHECK(client IN ('web','native')), mode TEXT NOT NULL CHECK(mode IN ('login','signup','link')),
    binding_hash TEXT NOT NULL, payload TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    phase TEXT NOT NULL DEFAULT 'pending' CHECK(phase IN ('pending','checking','handoff')),
    attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE auth_signin_flows DROP CONSTRAINT IF EXISTS auth_signin_flows_mode_check,
    ADD CONSTRAINT auth_signin_flows_mode_check CHECK(mode IN ('login','signup','link'))`,
  `CREATE INDEX IF NOT EXISTS auth_signin_expiry_idx ON auth_signin_flows(expires_at)`,
  `CREATE TABLE IF NOT EXISTS auth_phone_limits (
    key TEXT PRIMARY KEY, last_sent TIMESTAMPTZ NOT NULL, hour_start TIMESTAMPTZ NOT NULL,
    day_start TIMESTAMPTZ NOT NULL, hour_count INTEGER NOT NULL, day_count INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_login_identities (
    provider TEXT NOT NULL CHECK(provider IN ('google','apple','phone')), subject TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(provider,subject), UNIQUE(user_id,provider)
  )`,
  `INSERT INTO auth_login_identities(provider,subject,user_id)
    SELECT auth_provider,auth_subject,id FROM users
    WHERE auth_provider IN ('google','apple','phone') AND auth_subject IS NOT NULL
    ON CONFLICT DO NOTHING`,
];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const validOpaque = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{40,100}$/.test(value);
const fail = (message, status = 400, code = 'failed') => Object.assign(new Error(message), { status, publicCode: code });
const isDeliverableEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.toLowerCase().endsWith(`@${PHONE_ALIAS_DOMAIN}`);
function phoneNumber(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 500 || !/^\/(?!\/)/.test(value) || /[\\\x00-\x20]/.test(value)) return '';
  const parsed = new URL(value, 'https://uficonnect.com');
  return parsed.origin === 'https://uficonnect.com' && !/^\/(?:auth|login|register)(?:\/|$)/.test(parsed.pathname) ? parsed.pathname + parsed.search + parsed.hash : '';
}
const credential = value => typeof value === 'string' ? value.trim() : '';
function appleSigningKey(value) {
  if (!/^-----BEGIN PRIVATE KEY-----\r?\n/.test(value)) return false;
  try {
    const key = crypto.createPrivateKey(value);
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch { return false; }
}
function encryptionKeyConfigured(value) {
  if (typeof value !== 'string' || !value) return false;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 && key.toString('base64') === value;
}
function providerSettings(env) {
  const dedicatedGoogle = Boolean(credential(env.GOOGLE_CLIENT_ID) || credential(env.GOOGLE_CLIENT_SECRET));
  const googleClientId = credential(dedicatedGoogle ? env.GOOGLE_CLIENT_ID : env.YOUTUBE_CLIENT_ID);
  const googleClientSecret = credential(dedicatedGoogle ? env.GOOGLE_CLIENT_SECRET : env.YOUTUBE_CLIENT_SECRET);
  const apple = { clientId: credential(env.APPLE_CLIENT_ID), teamId: credential(env.APPLE_TEAM_ID),
    keyId: credential(env.APPLE_KEY_ID), privateKey: credential(env.APPLE_PRIVATE_KEY).replace(/\\n/g, '\n') };
  const phone = { accountSid: credential(env.TWILIO_ACCOUNT_SID), authToken: credential(env.TWILIO_AUTH_TOKEN), serviceSid: credential(env.TWILIO_VERIFY_SERVICE_SID) };
  return {
    google: { configured: Boolean(googleClientId && googleClientSecret), clientId: googleClientId, clientSecret: googleClientSecret,
      callbackPath: dedicatedGoogle ? '/auth/providers/google/callback' : '/auth/social/youtube/callback' },
    apple: { ...apple, configured: Boolean(apple.clientId && apple.teamId && apple.keyId && appleSigningKey(apple.privateKey)) },
    phone: { ...phone, configured: /^AC[a-f0-9]{32}$/i.test(phone.accountSid) && Boolean(phone.authToken) && /^VA[a-f0-9]{32}$/i.test(phone.serviceSid) },
  };
}

let josePromise;
const jose = () => josePromise ||= import('jose');
const remoteKeys = new Map();
async function verifyIdentityToken(provider, token, { audience, nonce, keySet } = {}) {
  const { jwtVerify, createRemoteJWKSet } = await jose();
  const issuer = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com';
  if (!keySet) {
    if (!remoteKeys.has(provider)) remoteKeys.set(provider, createRemoteJWKSet(new URL(provider === 'google' ? 'https://www.googleapis.com/oauth2/v3/certs' : 'https://appleid.apple.com/auth/keys'), { timeoutDuration: 5000 }));
    keySet = remoteKeys.get(provider);
  }
  const { payload } = await jwtVerify(token, keySet, { algorithms: ['RS256'], issuer, audience, clockTolerance: 5, maxTokenAge: '10m', requiredClaims: ['sub','iat','exp','nonce'] });
  if ((payload.azp != null && payload.azp !== audience) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience)) throw fail('The sign-in response has an unexpected authorized client.');
  if (!nonce || payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw fail('The sign-in response could not be verified.');
  const verified = payload.email_verified === true || (provider === 'apple' && payload.email_verified === 'true');
  if (payload.email && (!verified || !isDeliverableEmail(payload.email))) throw fail('Your provider must supply a verified email address.');
  if (provider === 'google' && !payload.email) throw fail('Your provider must supply a verified email address.');
  return { provider, subject: payload.sub, email: payload.email ? payload.email.trim().toLowerCase() : '', name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : '' };
}

function createSignIn({ db, env = process.env, vault, callbackBase, frontendBase, issueSession, profileFor, onUser, onCreated = () => {}, recordSignIn = () => {}, fetcher = fetch, keySets = {}, phoneProvider,
  reportFailure = diagnostic => console.warn('[signin] callback failure', JSON.stringify(diagnostic)) } = {}) {
  const settings = providerSettings(env);
  const callback = provider => `${callbackBase}${provider === 'google' ? settings.google.callbackPath : `/auth/providers/${provider}/callback`}`;
  const storageReady = () => db.isConnected() && encryptionKeyConfigured(env.OAUTH_TOKEN_ENCRYPTION_KEY);
  const publicProviders = () => ({ providers: Object.fromEntries(Object.entries(settings).map(([id, value]) => [id, { configured: value.configured, enabled: value.configured && storageReady() }])) });
  const ensure = provider => {
    if (!settings[provider]?.configured) throw fail('This sign-in method is not available yet.', 503, 'unavailable');
    if (!storageReady()) throw fail('Sign-in storage is temporarily unavailable.', 503, 'unavailable');
  };
  const seal = (id, value) => vault.seal(JSON.stringify(value), `signin:${id}`);
  const open = row => JSON.parse(vault.open(row.payload, `signin:${row.id}`));
  async function prune() {
    await db.query('DELETE FROM auth_signin_flows WHERE expires_at < NOW()');
    await db.query("DELETE FROM auth_phone_limits WHERE last_sent < NOW() - INTERVAL '2 days'");
  }
  async function form(url, params, headers = {}) {
    const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(15000) });
    let result;
    try { result = await response.json(); } catch { throw fail('The sign-in provider is temporarily unavailable.', 502, 'unavailable'); }
    if (!response.ok) {
      if (url.startsWith('https://verify.twilio.com/v2/') && Number(result?.code) === 21608)
        throw fail('Phone verification is not available for this number. Choose another sign-in method.', 503, 'phone_delivery_unavailable');
      const error = fail('The sign-in provider could not complete verification.', 502, 'unavailable');
      if (['https://oauth2.googleapis.com/token','https://appleid.apple.com/auth/token'].includes(url) && PROVIDER_FAILURE_CODES.has(result?.error)) error.providerCode = result.error;
      throw error;
    }
    return result;
  }
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try { const result=await work(client); await client.query('COMMIT'); return result; }
      catch(error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  const identityLookup = `SELECT u.* FROM users u WHERE (u.auth_provider=$1 AND u.auth_subject=$2)
    OR EXISTS(SELECT 1 FROM auth_login_identities i WHERE i.user_id=u.id AND i.provider=$1 AND i.subject=$2) LIMIT 1`;
  function linkContext(user) {
    if (!user?.id || !user.sid || !Number.isSafeInteger(user.ver)) throw fail('Sign in again before connecting a login method.',401,'invalid_flow');
    return { id:user.id, sid:user.sid, ver:user.ver };
  }
  async function linkIdentity(identity, context, phoneReplacement) {
    if (!context?.id || !context.sid || !Number.isSafeInteger(context.ver)) throw fail('Sign in again before connecting a login method.',401,'invalid_flow');
    try {
      return await transaction(async client => {
        const current=(await client.query(`SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id
          WHERE u.id=$1 AND s.id=$2 AND u.auth_version=$3 AND s.expires_at>NOW() FOR UPDATE OF u,s`,[context.id,context.sid,context.ver])).rows[0];
        if (!current) throw fail('Your session changed. Sign in again before connecting a login method.',401,'invalid_flow');
        const owner=(await client.query(identityLookup,[identity.provider,identity.subject])).rows[0];
        if (owner && owner.id!==current.id) throw fail('This sign-in method is already connected to another account.',409,'account_exists');
        const linked=(await client.query('SELECT subject FROM auth_login_identities WHERE user_id=$1 AND provider=$2',[current.id,identity.provider])).rows[0];
        const replacing = identity.provider === 'phone' && phoneReplacement;
        if (replacing) {
          const primary = current.auth_provider === 'phone' ? current.auth_subject : null;
          if ((linked?.subject || null) !== phoneReplacement.previousSubject || primary !== phoneReplacement.previousPrimarySubject) throw fail('Your phone sign-in method changed. Start verification again.',409,'invalid_flow');
          await client.query("DELETE FROM auth_login_identities WHERE user_id=$1 AND provider='phone'",[current.id]);
        } else if (linked && linked.subject!==identity.subject) throw fail('A different identity from this provider is already connected to your account.',409,'account_exists');
        await client.query(`INSERT INTO auth_login_identities(provider,subject,user_id) VALUES($1,$2,$3)
          ON CONFLICT(provider,subject) DO NOTHING`,[identity.provider,identity.subject,current.id]);
        // A conflicting claim must not be treated as a successful link.
        const claimed=(await client.query('SELECT user_id FROM auth_login_identities WHERE provider=$1 AND subject=$2',[identity.provider,identity.subject])).rows[0];
        if (claimed?.user_id!==current.id) throw fail('This sign-in method is already connected to another account.',409,'account_exists');
        if(identity.provider==='phone') {
          const updated=await client.query("UPDATE users SET phone=$1,auth_subject=CASE WHEN auth_provider='phone' THEN $1 ELSE auth_subject END WHERE id=$2 RETURNING *",[identity.subject,current.id]);
          return {row:updated.rows[0],created:false};
        }
        return {row:current,created:false};
      });
    } catch(error) {
      if(error.code==='23505') throw fail('This sign-in method is already connected to an account.',409,'account_exists');
      throw error;
    }
  }
  async function linked(user) {
    if(!db.isConnected()) throw fail('Sign-in storage is temporarily unavailable.',503,'unavailable');
    const rows=(await db.query('SELECT provider,created_at FROM auth_login_identities WHERE user_id=$1 ORDER BY provider',[user.id])).rows;
    return {methods:rows.map(row=>({provider:row.provider,linkedAt:row.created_at})),passwordAvailable:(user.authProvider||'local')==='local'};
  }
  async function provision(identity, details = {}) {
    // Only a verified provider subject authorizes an existing account. Profile
    // phone numbers and matching email addresses never grant account access.
    if(details.mode==='link') return linkIdentity(identity,details.linkContext,details.phoneReplacement);
    const existing = await db.query(identityLookup, [identity.provider, identity.subject]);
    if (existing.rows[0]) return { row: existing.rows[0], created: false };
    if (identity.provider === 'phone' && details.mode !== 'signup') throw fail('No phone sign-in account exists for this number. Choose Sign up to create one.', 404, 'account_missing');
    const placeholder = identity.provider === 'phone';
    const email = placeholder ? `${crypto.randomUUID()}@${PHONE_ALIAS_DOMAIN}` : identity.email;
    if (!email) throw fail('Your provider must supply a verified email address for signup.');
    if (!placeholder && (await db.query('SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1', [email])).rows.length) throw fail('An account already uses this email. Sign in with your existing method.', 409, 'account_exists');
    const name = (details.name || identity.name || email.split('@')[0] || 'UFIConnect member').trim().slice(0, 120);
    const hash = await bcrypt.hash(random(), 12);
    try {
      const result = await transaction(async client=>{
        const inserted=await client.query(`INSERT INTO users (name,email,email_is_placeholder,phone,password_hash,auth_provider,auth_subject,title)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [name, email, placeholder, placeholder ? identity.subject : '', hash, identity.provider, identity.subject, details.title || '']);
        await client.query('INSERT INTO auth_login_identities(provider,subject,user_id) VALUES($1,$2,$3)',[identity.provider,identity.subject,inserted.rows[0].id]);
        return inserted;
      });
      onCreated();
      return { row: result.rows[0], created: true };
    } catch (error) {
      if (error.code !== '23505') throw error;
      const winner = await db.query(identityLookup, [identity.provider, identity.subject]);
      if (winner.rows[0]) return { row: winner.rows[0], created: false };
      throw fail('An account already uses this email. Sign in with your existing method.', 409, 'account_exists');
    }
  }
  async function session(identity, details, req, onStage = () => {}) {
    onStage('account');
    const { row, created } = await provision(identity, details);
    onStage('session');
    const user = onUser(row);
    const token = await issueSession(user);
    recordSignIn(user, req);
    return { token, profile: await profileFor(user), created };
  }
  function flowCookie(value, maxAge = 600) {
    return `ufi_signin=${value}; Path=/auth; HttpOnly; Max-Age=${maxAge}; SameSite=${env.NODE_ENV === 'production' ? 'None; Secure' : 'Lax'}`;
  }
  function browserBinding(req) {
    const match = String(req.headers?.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ufi_signin='));
    return match ? match.slice('ufi_signin='.length) : '';
  }
  async function start(provider, input = {}, res, authenticatedLinkUser) {
    ensure(provider);
    if (!['google','apple'].includes(provider)) throw fail('Choose an available sign-in provider.');
    const client = input.client === 'native' ? 'native' : 'web';
    const mode = authenticatedLinkUser ? 'link' : input.mode === 'signup' ? 'signup' : 'login';
    const state = PREFIX + random();
    const id = digest(state), binding = random(), nonce = random(), codeVerifier = random();
    const payload = { nonce, codeVerifier, returnTo: safeReturnTo(input.returnTo), ...(authenticatedLinkUser ? {linkContext:linkContext(authenticatedLinkUser)} : {}) };
    await prune();
    await db.query(`INSERT INTO auth_signin_flows (id,provider,client,mode,binding_hash,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '10 minutes')`, [id, provider, client, mode, digest(binding), seal(id, payload)]);
    if (client === 'web') res?.append('Set-Cookie', flowCookie(binding));
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://appleid.apple.com/auth/authorize');
    Object.entries({ client_id: settings[provider].clientId, redirect_uri: callback(provider), response_type: 'code', scope: provider === 'google' ? 'openid email profile' : 'name email', state, nonce }).forEach(([k,v]) => url.searchParams.set(k,v));
    if (provider === 'google') {
      // Account authentication stays separate from permissions to read a
      // connected source, including when reusing the YouTube OAuth client.
      url.searchParams.set('include_granted_scopes', 'false');
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('code_challenge', crypto.createHash('sha256').update(codeVerifier).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
    } else url.searchParams.set('response_mode', 'form_post');
    return { url: url.toString(), authorizationUrl: url.toString(), ...(client === 'native' ? { verifier: binding } : {}) };
  }
  async function appleSecret() {
    const { SignJWT, importPKCS8 } = await jose();
    const key = await importPKCS8(settings.apple.privateKey, 'ES256');
    return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: settings.apple.keyId }).setIssuer(settings.apple.teamId).setSubject(settings.apple.clientId).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key);
  }
  async function complete(provider, req, res) {
    const params = req.method === 'POST' ? req.body : req.query;
    const state = params?.state;
    let row, stage = 'flow';
    try {
      ensure(provider);
      if (typeof state !== 'string' || !state.startsWith(PREFIX) || !validOpaque(state.slice(PREFIX.length))) throw fail('This sign-in request has expired. Start again.', 400, 'expired');
      const id = digest(state);
      row = (await db.query('SELECT * FROM auth_signin_flows WHERE id=$1 AND provider=$2 AND phase=$3 AND expires_at>NOW()', [id, provider, 'pending'])).rows[0];
      if (!row) throw fail('This sign-in request has expired. Start again.', 400, 'expired');
      stage = 'binding';
      if (row.client === 'web' && (!validOpaque(browserBinding(req)) || digest(browserBinding(req)) !== row.binding_hash)) throw fail('Start sign-in in this browser and try again.', 400, 'browser_binding');
      // Consume before any external request: callback replay cannot create a
      // second session, including when provider verification is slow.
      stage = 'flow';
      const consumed = await db.query('DELETE FROM auth_signin_flows WHERE id=$1 AND phase=$2 AND expires_at>NOW() RETURNING *', [id,'pending']);
      if (!consumed.rows[0]) throw fail('This sign-in request has expired. Start again.', 400, 'expired');
      const payload = open(row);
      if (params.error) {
        const error = fail('Sign-in was cancelled.', 400, 'cancelled');
        if (PROVIDER_FAILURE_CODES.has(params.error)) error.providerCode = params.error;
        throw error;
      }
      if (typeof params.code !== 'string' || !params.code || params.code.length > 4096) throw fail('The provider did not return a sign-in code.');
      stage = 'token';
      const tokens = await form(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token', {
        grant_type: 'authorization_code', code: params.code, client_id: settings[provider].clientId,
        client_secret: provider === 'google' ? settings.google.clientSecret : await appleSecret(), redirect_uri: callback(provider),
        ...(provider === 'google' ? { code_verifier: payload.codeVerifier } : {}),
      });
      stage = 'identity';
      const identity = await verifyIdentityToken(provider, tokens.id_token, { audience: settings[provider].clientId, nonce: payload.nonce, keySet: keySets[provider] });
      if (provider === 'apple' && typeof params.user === 'string' && params.user.length <= 4096) {
        try { const name = JSON.parse(params.user)?.name; identity.name = [name?.firstName,name?.lastName].filter(v=>typeof v==='string').join(' ').slice(0,120); } catch {}
      }
      if (row.client === 'native') {
        stage = 'session';
        const code = random(), handoffId = digest(code);
        await db.query(`INSERT INTO auth_signin_flows (id,provider,client,mode,binding_hash,payload,phase,expires_at)
          VALUES ($1,$2,'native',$3,$4,$5,'handoff',NOW()+INTERVAL '2 minutes')`, [handoffId, provider, row.mode, row.binding_hash, seal(handoffId, { identity, mode: row.mode, ...(payload.linkContext ? {linkContext:payload.linkContext} : {}) })]);
        return res.redirect(`uficonnect://auth/callback#code=${code}`);
      }
      const result = await session(identity, { mode: row.mode, linkContext:payload.linkContext }, req, value => { stage = value; });
      res.append('Set-Cookie', flowCookie('', 0));
      res.append('Set-Cookie', createSessionCookie(result.token, SESSION_TTL_SECONDS, env));
      const target = new URL(row.mode==='link'?'/settings':'/login', frontendBase);
      if(row.mode==='link') { target.searchParams.set('tab','security'); target.searchParams.set('linked',provider); }
      else { target.searchParams.set('provider', provider); if (payload.returnTo) target.searchParams.set('returnTo', payload.returnTo); }
      return res.redirect(target.toString());
    } catch (error) {
      const code = PUBLIC_FAILURE_CODES.has(error?.publicCode) ? error.publicCode : 'failed';
      // Log only bounded classifications. Error messages and provider payloads
      // can contain credentials or identity data and never enter diagnostics.
      const diagnostic = { provider: ['google','apple'].includes(provider) ? provider : 'unknown', stage: FAILURE_STAGES.has(stage) ? stage : 'flow', publicCode: code };
      if (PROVIDER_FAILURE_CODES.has(error?.providerCode)) diagnostic.providerCode = error.providerCode;
      if (IDENTITY_FAILURE_CODES.has(error?.code)) diagnostic.identityCode = error.code;
      try { reportFailure(diagnostic); } catch {}
      if (row?.client === 'native') return res.redirect(`uficonnect://auth/callback#error=${encodeURIComponent(code)}`);
      const target = new URL(row?.mode==='link'?'/settings':'/login', frontendBase);
      if(row?.mode==='link') target.searchParams.set('tab','security');
      target.searchParams.set('auth_error', code);
      return res.redirect(target.toString());
    }
  }
  async function finish(input, req) {
    if (!validOpaque(input?.code) || !validOpaque(input?.verifier)) throw fail('This sign-in request has expired. Start again.');
    if (!db.isConnected()) throw fail('Sign-in storage is temporarily unavailable.', 503, 'unavailable');
    const result = await db.query("DELETE FROM auth_signin_flows WHERE id=$1 AND binding_hash=$2 AND client='native' AND phase='handoff' AND expires_at>NOW() RETURNING *", [digest(input.code), digest(input.verifier)]);
    if (!result.rows[0]) throw fail('This sign-in request has expired. Start again.');
    const payload = open(result.rows[0]);
    return session(payload.identity, payload, req);
  }
  const twilio = phoneProvider || {
    async request(number) { return form(`https://verify.twilio.com/v2/Services/${settings.phone.serviceSid}/Verifications`, { To: number, Channel: 'sms' }, { Authorization: `Basic ${Buffer.from(`${settings.phone.accountSid}:${settings.phone.authToken}`).toString('base64')}` }); },
    async verify(sid, code) { return form(`https://verify.twilio.com/v2/Services/${settings.phone.serviceSid}/VerificationCheck`, { VerificationSid: sid, Code: code }, { Authorization: `Basic ${Buffer.from(`${settings.phone.accountSid}:${settings.phone.authToken}`).toString('base64')}` }); },
  };
  async function requestPhone(input, authenticatedLinkUser) {
    ensure('phone');
    const number = phoneNumber(input?.phoneNumber);
    const mode = authenticatedLinkUser ? 'link' : input?.mode === 'signup' ? 'signup' : 'login';
    const context = authenticatedLinkUser ? linkContext(authenticatedLinkUser) : null;
    if (!number) throw fail('Enter a phone number with its country code, such as +1 555 123 4567.');
    if (mode === 'signup' && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)) throw fail('Enter your name to create an account.');
    if (input.title != null && (typeof input.title !== 'string' || input.title.length > 250)) throw fail('Enter a shorter job title.');
    let phoneReplacement;
    if (context && input.replacePhone === true) {
      const current=(await db.query('SELECT auth_provider,auth_subject FROM users WHERE id=$1',[context.id])).rows[0];
      if (!current) throw fail('Sign in again before changing your phone number.',401,'invalid_flow');
      const linked=(await db.query("SELECT subject FROM auth_login_identities WHERE user_id=$1 AND provider='phone'",[context.id])).rows[0];
      phoneReplacement = { previousSubject: linked?.subject || null, previousPrimarySubject: current.auth_provider === 'phone' ? current.auth_subject : null };
    }
    const key = crypto.createHmac('sha256', env.JWT_SECRET).update(number).digest('hex');
    await prune();
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO auth_phone_limits (key,last_sent,hour_start,day_start,hour_count,day_count)
          VALUES ($1,NOW()-INTERVAL '1 hour',DATE_TRUNC('hour',NOW()),DATE_TRUNC('day',NOW()),0,0) ON CONFLICT DO NOTHING`, [key]);
        const sent = await client.query(`UPDATE auth_phone_limits SET last_sent=NOW(),
          hour_count=CASE WHEN hour_start=DATE_TRUNC('hour',NOW()) THEN hour_count+1 ELSE 1 END,
          day_count=CASE WHEN day_start=DATE_TRUNC('day',NOW()) THEN day_count+1 ELSE 1 END,
          hour_start=DATE_TRUNC('hour',NOW()),day_start=DATE_TRUNC('day',NOW())
          WHERE key=$1 AND last_sent<NOW()-INTERVAL '60 seconds'
          AND (hour_start<>DATE_TRUNC('hour',NOW()) OR hour_count<5)
          AND (day_start<>DATE_TRUNC('day',NOW()) OR day_count<20) RETURNING key`, [key]);
        if (!sent.rows.length) throw fail('Wait before requesting another code.', 429, 'rate_limited');
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    const response = await twilio.request(number);
    if (response.status !== 'pending' || !/^VE[a-f0-9]{32}$/i.test(response.sid || '')) throw fail('Could not send a verification code. Try again later.', 502, 'unavailable');
    const verificationId = random(), id = digest(verificationId);
    await db.query(`INSERT INTO auth_signin_flows (id,provider,client,mode,binding_hash,payload,expires_at)
      VALUES ($1,'phone','web',$2,$3,$4,NOW()+INTERVAL '10 minutes')`, [id, mode, key, seal(id, { number, sid: response.sid, mode, name: mode === 'signup' ? input.name.trim() : '', title: input.title || '', ...(context ? {linkContext:context} : {}), ...(phoneReplacement ? {phoneReplacement} : {}) })]);
    return { verificationId, expiresIn: 600, resendAfter: 60 };
  }
  async function verifyPhone(input, req) {
    ensure('phone');
    if (!validOpaque(input?.verificationId) || typeof input?.code !== 'string' || !/^\d{4,10}$/.test(input.code)) throw fail('Enter the code from your text message.');
    const id = digest(input.verificationId);
    const claimed = await db.query("UPDATE auth_signin_flows SET phase='checking', attempts=attempts+1 WHERE id=$1 AND provider='phone' AND phase='pending' AND attempts<5 AND expires_at>NOW() RETURNING *", [id]);
    if (!claimed.rows[0]) throw fail('This code has expired or reached its attempt limit. Request a new code.');
    const payload = open(claimed.rows[0]);
    let check;
    try { check = await twilio.verify(payload.sid, input.code); }
    catch (error) { await db.query("UPDATE auth_signin_flows SET phase='pending' WHERE id=$1 AND phase='checking'", [id]); throw error; }
    if (check.status !== 'approved' || check.sid !== payload.sid) {
      await db.query("UPDATE auth_signin_flows SET phase='pending' WHERE id=$1 AND phase='checking'", [id]);
      throw fail('The code is incorrect or has expired.');
    }
    if (payload.mode === 'login' && !(await db.query(identityLookup, ['phone', payload.number])).rows[0]) {
      // Keep verified ownership while a new member supplies their name. This
      // encrypted, short-lived proof replaces the OTP and can be used once.
      const registrationId = random(), registrationKey = digest(registrationId);
      await transaction(async client => {
        const consumed = await client.query("DELETE FROM auth_signin_flows WHERE id=$1 AND phase='checking' AND expires_at>NOW() RETURNING id", [id]);
        if (!consumed.rows[0]) throw fail('This code has already been used or expired.');
        await client.query(`INSERT INTO auth_signin_flows (id,provider,client,mode,binding_hash,payload,phase,expires_at)
          VALUES ($1,'phone','web','signup',$2,$3,'handoff',NOW()+INTERVAL '5 minutes')`,
        [registrationKey, claimed.rows[0].binding_hash, seal(registrationKey, { number: payload.number, mode: 'signup', phoneSignupVerified: true })]);
      });
      return { requiresSignup: true, registrationId, expiresIn: 300 };
    }
    const consumed = await db.query("DELETE FROM auth_signin_flows WHERE id=$1 AND phase='checking' RETURNING id", [id]);
    if (!consumed.rows[0]) throw fail('This code has already been used.');
    return session({ provider: 'phone', subject: payload.number }, payload, req);
  }
  async function completePhoneSignup(input, req) {
    ensure('phone');
    if (!validOpaque(input?.registrationId)) throw fail('Phone verification has expired. Request a new code.', 400, 'expired');
    if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 120) throw fail('Enter your name to create an account.');
    const consumed = await db.query("DELETE FROM auth_signin_flows WHERE id=$1 AND provider='phone' AND client='web' AND mode='signup' AND phase='handoff' AND expires_at>NOW() RETURNING *", [digest(input.registrationId)]);
    if (!consumed.rows[0]) throw fail('Phone verification has expired or has already been used. Request a new code.', 400, 'expired');
    const payload = open(consumed.rows[0]);
    if (payload.phoneSignupVerified !== true || phoneNumber(payload.number) !== payload.number) throw fail('Request a new phone verification code.', 400, 'expired');
    return session({ provider: 'phone', subject: payload.number }, { mode: 'signup', name: input.name.trim() }, req);
  }
  return { publicProviders, start, complete, finish, requestPhone, verifyPhone, completePhoneSignup, provision, callback, prune, linked };
}

function registerSignInRoutes(app, options) {
  const service = createSignIn(options);
  const cleanup = options.schedule?.(() => { if (options.db.isConnected()) void service.prune().catch(() => {}); }, 10 * 60 * 1000);
  cleanup?.unref?.();
  const limiter = options.limiter;
  const guarded = handler => async (req,res) => {
    try { const result = await handler(req,res); if (!res.headersSent) res.json(result); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Sign-in is temporarily unavailable. Please try again.', code: error.publicCode || 'unavailable' }); }
  };
  app.get('/auth/providers', (_req,res) => res.json(service.publicProviders()));
  app.get('/auth/providers/linked', options.authenticate, guarded(req=>service.linked(req.user)));
  app.post('/auth/providers/:provider/link', options.authenticate, limiter, guarded((req,res)=>service.start(req.params.provider,req.body,res,req.user)));
  app.post('/auth/phone/link', options.authenticate, limiter, guarded(req=>service.requestPhone(req.body,req.user)));
  app.get('/auth/providers/:provider/start', limiter, guarded(async(req,res) => res.redirect((await service.start(req.params.provider, { ...req.query, client:'web' }, res)).url)));
  app.post('/auth/providers/:provider/start', limiter, guarded((req,res) => service.start(req.params.provider, req.body, res)));
  app.get('/auth/providers/google/callback', limiter, (req,res) => service.complete('google', req,res));
  app.get('/auth/social/youtube/callback', limiter, (req,res,next) => typeof req.query.state === 'string' && req.query.state.startsWith(PREFIX) ? service.complete('google',req,res) : next());
  app.post('/auth/providers/apple/callback', limiter, express.urlencoded({ extended:false, limit:'12kb', parameterLimit:10 }), (req,res) => service.complete('apple',req,res));
  app.post('/auth/providers/finish', limiter, guarded(async(req,res) => { const result = await service.finish(req.body,req); options.setSessionCookie(res,result.token); return result; }));
  app.post('/auth/phone/request', limiter, guarded(req => service.requestPhone(req.body)));
  app.post('/auth/phone/verify', limiter, guarded(async(req,res) => { const result = await service.verifyPhone(req.body,req); if (result.token) options.setSessionCookie(res,result.token); return result; }));
  app.post('/auth/phone/complete-signup', limiter, guarded(async(req,res) => { const result = await service.completePhoneSignup(req.body,req); options.setSessionCookie(res,result.token); return result; }));
  return service;
}

module.exports = { SIGNIN_SCHEMA, PHONE_ALIAS_DOMAIN, isDeliverableEmail, phoneNumber, safeReturnTo, providerSettings, verifyIdentityToken, createSignIn, registerSignInRoutes };
