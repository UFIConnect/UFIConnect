'use strict';
const crypto = require('node:crypto');
const { localTextScreen, cleanScreeningText } = require('./content-screening');
const THRESHOLD = 5;
const COOKIE = '__Host-ufi_device';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REASONS = new Set(['repetitive_content', 'link_spam', 'spam_or_solicitation', 'credential_phishing']);
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_security_devices (id UUID PRIMARY KEY, strikes INTEGER NOT NULL DEFAULT 0, review_epoch INTEGER NOT NULL DEFAULT 0, blocked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS office_security_device_sessions (session_hash TEXT PRIMARY KEY, device_id UUID NOT NULL REFERENCES office_security_devices(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS office_security_device_user ON office_security_device_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS office_security_device_events (id TEXT PRIMARY KEY, device_id UUID NOT NULL REFERENCES office_security_devices(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE SET NULL, reason TEXT NOT NULL, activity TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS office_security_device_events_time ON office_security_device_events(device_id,occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS office_security_device_reviews (id UUID PRIMARY KEY, device_id UUID NOT NULL REFERENCES office_security_devices(id) ON DELETE CASCADE, reason TEXT NOT NULL, previous_strikes INTEGER NOT NULL, reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];
function contentActivity(req) {
  if (req.method === 'PATCH') return /^\/posts\/[^/]+$/.test(req.path);
  return req.method === 'POST' && /^(?:\/groups\/[^/]+\/posts|\/posts\/[^/]+\/comments|\/snaps(?:\/[^/]+\/comments)?|\/restaurants\/[^/]+\/comments|\/business\/posts|\/command-center\/cross-post|\/messages\/[^/]+)$/.test(req.path);
}
function contentForActivity(req) {
  const body = req.body || {};
  const fields = req.path === '/business/posts'
    ? ['title','company','location','pay','description','duties','requirements','applyUrl'].map(key => body.details?.[key])
    : req.path === '/snaps' ? [body.caption,body.overlayText] : [body.content];
  return fields.filter(value => typeof value === 'string').join('\n');
}
function suspiciousReason(content) {
  const text = cleanScreeningText(content);
  const prose = text.replace(/\bhttps?:\/\/[^\s<>]+/gi, '');
  // Explicit requests for secrets count; safety advice and quoted discussion do not.
  const secretRequest = /\b(?:send|share|give|enter|submit)\s+(?:me\s+|us\s+)?your\s+(?:password|one[- ]time (?:code|password)|verification code|seed phrase|recovery phrase)\b/i;
  if (secretRequest.test(prose) && /https?:\/\//i.test(text) && !/\b(?:never|do not|don't|avoid|example|warning|beware|phishing|scam)\b/i.test(prose)) return 'credential_phishing';
  const result = localTextScreen(text);
  // General content screening may still reject this submission, but a
  // discussion warning against a scam is not reliable evidence for a strike.
  const safetyDiscussion = /\b(?:beware|warning)\b/i.test(prose)
    || /\b(?:never|do not|don't|avoid)\s+(?:buy|purchase|sell|send|share|give|enter|submit)\b/i.test(prose);
  if (result.reason === 'spam_or_solicitation' && safetyDiscussion) return null;
  return !result.allowed && REASONS.has(result.reason) ? result.reason : null;
}
function createSuspiciousDevices({ db, secret, production = false, now = Date.now }) {
  const digest = value => crypto.createHmac('sha256',secret).update(String(value)).digest('hex');
  function token(id) { const value = `${id}.${Math.floor(now()/1000) + 365*86400}`; return `${value}.${digest(`device:${value}`)}`; }
  function verify(value) {
    if(typeof value !== 'string' || value.length > 200) return null;
    const [id,expires,signature,...rest] = value.split('.');
    if(rest.length || !UUID.test(id || '') || !/^\d+$/.test(expires || '') || Number(expires) <= now()/1000 || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
    const expected = digest(`device:${id}.${expires}`);
    return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature)) ? id : null;
  }
  function cookie(req) { const raw = String(req.headers?.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`)); return verify(raw?.slice(COOKIE.length+1)); }
  async function initialize() { for(const sql of SCHEMA) await db.query(sql); }
  async function identify(req,res) {
    const sessionHash = digest(`session:${req.user.sid || req.authToken}`), cookieId = cookie(req);
    const id = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[sessionHash]);
        const existing = (await client.query('SELECT device_id FROM office_security_device_sessions WHERE session_hash=$1 AND user_id=$2',[sessionHash,req.user.id])).rows[0];
        let selected = existing?.device_id || cookieId || crypto.randomUUID();
        // Neither identity may mask the other: a clean existing session must
        // not replace a blocked signed browser cookie with its own clean ID.
        if (cookieId && cookieId !== existing?.device_id) {
          const cookieDevice = (await client.query('SELECT blocked_at FROM office_security_devices WHERE id=$1',[cookieId])).rows[0];
          if (cookieDevice?.blocked_at) selected = cookieId;
        }
        await client.query('INSERT INTO office_security_devices(id) VALUES ($1) ON CONFLICT(id) DO NOTHING',[selected]);
        await client.query('INSERT INTO office_security_device_sessions(session_hash,device_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[sessionHash,selected,req.user.id]);
        await client.query('COMMIT'); return selected;
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    });
    if(cookieId !== id) res.append('Set-Cookie',`${COOKIE}=${token(id)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None`);
    return id;
  }
  async function record({deviceId,userId,reason,activity,content}) {
    if(!REASONS.has(reason)) throw new Error('Unsupported suspicious activity reason.');
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const device = (await client.query('SELECT * FROM office_security_devices WHERE id=$1 FOR UPDATE',[deviceId])).rows[0];
        if(!device) throw new Error('Device is not registered.');
        const eventId = digest([deviceId,device.review_epoch,userId,reason,activity,cleanScreeningText(content).toLowerCase()].join('\n'));
        const inserted = await client.query(`INSERT INTO office_security_device_events(id,device_id,user_id,reason,activity) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[eventId,deviceId,userId,reason,activity]);
        const row = inserted.rows.length ? (await client.query(`UPDATE office_security_devices SET strikes=strikes+1, blocked_at=CASE WHEN strikes+1>$2 THEN COALESCE(blocked_at,NOW()) ELSE blocked_at END,last_seen_at=NOW() WHERE id=$1 RETURNING *`,[deviceId,THRESHOLD])).rows[0] : device;
        await client.query('COMMIT'); return {strikes:row.strikes,blocked:Boolean(row.blocked_at),counted:Boolean(inserted.rows.length),threshold:THRESHOLD};
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  async function guard(req,res,next) {
    if(['GET','HEAD','OPTIONS'].includes(req.method) || req.path === '/auth/logout') return next();
    // Synthetic development accounts have no persistent device identity.
    if(!UUID.test(req.user?.id || '') && !production) return next();
    if(!db.isConnected()) return res.status(503).json({message:'Device security checks are temporarily unavailable.'});
    try {
      const deviceId = await identify(req,res);
      const device = (await db.query('SELECT strikes,blocked_at FROM office_security_devices WHERE id=$1',[deviceId])).rows[0];
      if(!device) throw new Error('Missing device');
      if(device.blocked_at) return res.status(403).json({code:'DEVICE_BLOCKED',message:'This registered device is blocked after more than five detected suspicious activities. Contact support for review.'});
      if(contentActivity(req)) {
        const content = contentForActivity(req);
        const reason = suspiciousReason(content);
        if(reason) {
          const result = await record({deviceId,userId:req.user.id,reason,activity:req.path,content});
          return res.status(result.blocked ? 403 : 400).json({code:result.blocked ? 'DEVICE_BLOCKED' : 'SUSPICIOUS_ACTIVITY',message:result.blocked ? 'This device is blocked after its sixth detected suspicious activity. Contact support for review.' : 'This content was rejected by security screening.',reason,strikes:result.strikes});
        }
      }
      return next();
    } catch { return res.status(503).json({message:'Device security checks are temporarily unavailable. Please retry.'}); }
  }
  async function list(userId) {
    const params = userId ? [userId] : [];
    const rows = (await db.query(`SELECT d.*, (SELECT COUNT(DISTINCT user_id)::int FROM office_security_device_sessions s WHERE s.device_id=d.id) AS accounts FROM office_security_devices d WHERE ${userId ? 'EXISTS(SELECT 1 FROM office_security_device_sessions s WHERE s.device_id=d.id AND s.user_id=$1)' : 'd.strikes>0 OR d.blocked_at IS NOT NULL'} ORDER BY d.blocked_at DESC NULLS LAST,d.last_seen_at DESC LIMIT 100`,params)).rows;
    const ids = rows.map(row => row.id);
    const events = ids.length ? (await db.query('SELECT device_id,user_id,reason,activity,occurred_at FROM office_security_device_events WHERE device_id=ANY($1::uuid[]) ORDER BY occurred_at DESC LIMIT 200',[ids])).rows : [];
    return {threshold:THRESHOLD,blockOn:THRESHOLD+1,scope:'Registered browser device cookie, with an authenticated session fallback for clients without cookies. Clearing identity and creating a new session can evade device identification; this is not a hardware ban.',devices:rows.map(row => ({id:row.id,strikes:row.strikes,blockedAt:row.blocked_at,createdAt:row.created_at,accounts:row.accounts,events:events.filter(event => event.device_id === row.id)}))};
  }
  async function unblock(id,reason) {
    if(!UUID.test(id) || typeof reason !== 'string' || !reason.trim() || reason.length>500) throw Object.assign(new Error('Select a device and enter a review reason (up to 500 characters).'),{status:400});
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const row = (await client.query('SELECT * FROM office_security_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!row) throw Object.assign(new Error('Device not found.'),{status:404});
        await client.query('INSERT INTO office_security_device_reviews(id,device_id,reason,previous_strikes) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),id,reason.trim(),row.strikes]);
        await client.query('UPDATE office_security_devices SET strikes=0,blocked_at=NULL,review_epoch=review_epoch+1 WHERE id=$1',[id]);
        await client.query('COMMIT'); return {ok:true,message:'Device unblocked and strike count reset. Prior events and the review reason remain recorded.'};
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  return {initialize,guard,record,list,unblock,token,verify};
}
function registerSuspiciousDeviceRoutes(app,{service,requireOfficeToken}) {
  app.get('/office/security/devices',requireOfficeToken,async(req,res) => {
    if(req.query.userId && !UUID.test(String(req.query.userId))) return res.status(400).json({message:'Invalid user.'});
    try { res.set('Cache-Control','no-store').json(await service.list(req.query.userId)); } catch { res.status(503).json({message:'Device security records are unavailable.'}); }
  });
  app.post('/office/security/devices/:id/unblock',requireOfficeToken,async(req,res) => {
    if(req.body?.confirmed !== true) return res.status(400).json({message:'Confirm the device review.'});
    try { res.json(await service.unblock(req.params.id,req.body.reason)); } catch(error) { res.status(error.status || 503).json({message:error.status ? error.message : 'Device review could not be saved.'}); }
  });
}
module.exports = {SCHEMA,THRESHOLD,contentActivity,contentForActivity,suspiciousReason,createSuspiciousDevices,registerSuspiciousDeviceRoutes};
