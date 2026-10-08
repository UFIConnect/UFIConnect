'use strict';

const crypto = require('node:crypto');
const { isDeliverableEmail } = require('./auth-signin');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const PHONE_EMAIL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS phone_email_verifications (
    id CHAR(64) PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL, code_hash CHAR(64) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
    active BOOLEAN NOT NULL DEFAULT false, used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS phone_email_verifications_member ON phone_email_verifications(user_id,created_at DESC)`,
];
const fault = (status, message, code = 'failed') => Object.assign(new Error(message), { status, publicCode: code });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function emailAddress(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !isDeliverableEmail(email) || email.split('@')[0].length > 64
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(email)
    || email.startsWith('.') || email.includes('..') || email.includes('.@')) return null;
  return email;
}
function createPhoneEmailSettings({ db, env = process.env, vault, mailAvailable = () => false, sendMail,
  onUser = row => row, profileFor = user => user, codeFactory = () => String(crypto.randomInt(100000, 1000000)) }) {
  const available = () => db.isConnected() && Boolean(env.JWT_SECRET && env.OAUTH_TOKEN_ENCRYPTION_KEY) && mailAvailable();
  const stored = () => {
    if (!db.isConnected() || !env.JWT_SECRET || !env.OAUTH_TOKEN_ENCRYPTION_KEY) throw fault(503, 'Email verification is temporarily unavailable.', 'unavailable');
  };
  function identity(user) {
    if (!UUID.test(user?.id || '') || !UUID.test(user?.sid || '') || !Number.isSafeInteger(user?.ver) || user.ver < 0) {
      throw fault(401, 'Sign in again before adding an email address.', 'invalid_session');
    }
    return user;
  }
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try { const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  async function member(client, user) {
    const { rows } = await client.query(`SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE u.id=$1::uuid AND s.id=$2::uuid AND s.expires_at>NOW() FOR UPDATE OF u,s`, [user.id, user.sid]);
    const row = rows[0];
    if (!row || row.auth_version !== user.ver || row.billing_closed) throw fault(401, 'Sign in again before adding an email address.', 'invalid_session');
    if (!row.email_is_placeholder && isDeliverableEmail(row.email)) throw fault(409, 'Your account already has an email address.', 'email_exists');
    return row;
  }
  const codeHash = (id, code) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${id}:${code}`).digest('hex');
  async function request(user, input) {
    stored(); identity(user);
    const email = emailAddress(input?.email);
    if (!email) throw fault(400, 'Enter a valid email address.');
    if (!mailAvailable() || typeof sendMail !== 'function') throw fault(503, 'Email verification is not available yet. You can keep signing in with your phone.', 'unavailable');
    const verificationId = crypto.randomBytes(32).toString('base64url'), id = digest(verificationId), code = codeFactory();
    if (!/^\d{6}$/.test(code)) throw fault(503, 'Email verification is temporarily unavailable.', 'unavailable');
    await transaction(async client => {
      const row = await member(client, user);
      await client.query("DELETE FROM phone_email_verifications WHERE created_at<NOW()-INTERVAL '1 day'");
      const { rows: limits } = await client.query(`SELECT COUNT(*)::int AS total,
        COALESCE(BOOL_OR(created_at>NOW()-INTERVAL '60 seconds'),false) AS recent
        FROM phone_email_verifications WHERE user_id=$1::uuid AND created_at>NOW()-INTERVAL '1 hour'`, [user.id]);
      if (limits[0].recent || limits[0].total >= 5) throw fault(429, 'Wait before requesting another email code.', 'rate_limited');
      await client.query('UPDATE phone_email_verifications SET active=false WHERE user_id=$1::uuid', [user.id]);
      const payload = vault.seal(JSON.stringify({ email, sid: user.sid, ver: user.ver, previousEmail: row.email }), `phone-email:${id}`);
      await client.query(`INSERT INTO phone_email_verifications(id,user_id,payload,code_hash,expires_at)
        VALUES($1,$2::uuid,$3,$4,NOW()+INTERVAL '10 minutes')`, [id, user.id, payload, codeHash(id, code)]);
    });
    try {
      await sendMail({ to: { address: email }, subject: 'Verify your UFIConnect email address',
        text: `Your UFIConnect verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.` });
      await db.query(`UPDATE phone_email_verifications SET active=true WHERE id=$1 AND used_at IS NULL AND expires_at>NOW()
        AND NOT EXISTS(SELECT 1 FROM phone_email_verifications newer WHERE newer.user_id=$2::uuid AND newer.created_at>
          (SELECT created_at FROM phone_email_verifications WHERE id=$1))`, [id, user.id]);
    } catch {
      throw fault(503, 'The email code could not be sent. Try again later; phone sign-in still works.', 'unavailable');
    }
    return { verificationId, expiresIn: 600, resendAfter: 60 };
  }
  async function verify(user, input) {
    stored(); identity(user);
    if (!OPAQUE.test(input?.verificationId || '') || !/^\d{6}$/.test(input?.code || '')) throw fault(400, 'Enter the six-digit code from your email.');
    let result;
    try {
      result = await transaction(async client => {
        const row = await member(client, user), id = digest(input.verificationId);
        const { rows } = await client.query(`SELECT * FROM phone_email_verifications WHERE id=$1 AND user_id=$2::uuid
          AND active=true AND used_at IS NULL AND attempts<5 AND expires_at>NOW() FOR UPDATE`, [id, user.id]);
        if (!rows[0]) return { error: fault(400, 'This verification code expired or was already used. Request a new code.', 'invalid_flow') };
        const flow = rows[0], payload = JSON.parse(vault.open(flow.payload, `phone-email:${id}`));
        if (payload.sid !== user.sid || payload.ver !== user.ver || payload.previousEmail !== row.email) {
          return { error: fault(401, 'Start email verification again in this session.', 'invalid_session') };
        }
        const valid = crypto.timingSafeEqual(Buffer.from(flow.code_hash, 'hex'), Buffer.from(codeHash(id, input.code), 'hex'));
        await client.query('UPDATE phone_email_verifications SET attempts=attempts+1 WHERE id=$1', [id]);
        if (!valid) return { error: fault(400, 'The email verification code is incorrect.') };
        await client.query('UPDATE phone_email_verifications SET active=false,used_at=NOW() WHERE id=$1', [id]);
        const duplicate = await client.query('SELECT id FROM users WHERE lower(email)=$1 AND id<>$2::uuid', [payload.email, user.id]);
        if (duplicate.rows.length) return { error: fault(409, 'This email address belongs to another account. Use a different email.', 'account_exists') };
        const updated = await client.query('UPDATE users SET email=$2,email_is_placeholder=false WHERE id=$1::uuid RETURNING *', [user.id, payload.email]);
        return { row: updated.rows[0] };
      });
    } catch (error) {
      if (error.code === '23505') throw fault(409, 'This email address belongs to another account. Use a different email.', 'account_exists');
      throw error;
    }
    if (result.error) throw result.error;
    return { profile: await profileFor(onUser(result.row)) };
  }
  return { available, request, verify };
}
function registerPhoneEmailSettingsRoutes(app, options) {
  const service = createPhoneEmailSettings(options);
  const respond = work => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.json(await work(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Email verification is temporarily unavailable.', code: error.publicCode || 'unavailable' }); }
  };
  app.get('/auth/email/config', options.authenticate, respond(() => ({ available: service.available() })));
  app.post('/auth/email/request', options.authenticate, options.limiter, respond(req => service.request(req.user, req.body)));
  app.post('/auth/email/verify', options.authenticate, options.limiter, respond(req => service.verify(req.user, req.body)));
  return service;
}
module.exports = { PHONE_EMAIL_SCHEMA, emailAddress, createPhoneEmailSettings, registerPhoneEmailSettingsRoutes };
