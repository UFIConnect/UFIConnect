'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');
const { withActiveMembers } = require('./member-write');

const VIEWER_LIMIT = 6;
const LEASE = "INTERVAL '55 seconds'";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const INVITE = /^[A-Za-z0-9_-]{43}$/;
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const unavailable = 'This live session has ended or the invitation is unavailable.';
const failure = (status, message) => Object.assign(new Error(message), { status });
const inviteHash = token => createHash('sha256').update(token).digest('hex');

const GET_READY_LIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS get_ready_live_sessions (
    id UUID PRIMARY KEY,
    host_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    invite_nonce TEXT NOT NULL,
    invite_hash TEXT NOT NULL UNIQUE,
    lease_until TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS get_ready_live_sessions_expiry_idx ON get_ready_live_sessions(lease_until)',
  `CREATE TABLE IF NOT EXISTS get_ready_live_viewers (
    session_id UUID NOT NULL REFERENCES get_ready_live_sessions(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    offer TEXT,
    answer TEXT,
    lease_until TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (session_id, member_id),
    UNIQUE (session_id, id)
  )`,
  'CREATE INDEX IF NOT EXISTS get_ready_live_viewers_expiry_idx ON get_ready_live_viewers(lease_until)',
];

function unblocked(host, member) {
  return `NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=${host}::text AND b.blocked_id=${member}::text) OR
    (b.blocker_id=${member}::text AND b.blocked_id=${host}::text))`;
}

function sessionInfo(row) {
  return { id: row.id, title: row.title, hostName: row.host_name, viewerLimit: VIEWER_LIMIT };
}

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure(404, unavailable);
  return value;
}

function description(value) {
  if (typeof value !== 'string' || value.length > 24300 || !/^v=0\r?\n/.test(value) || value.includes('\0')) {
    throw failure(400, 'Invalid live video connection details.');
  }
  return value;
}

function createLiveIceServers({ getConfig, fetcher = fetch }) {
  return async function iceServers() {
    const { keyId, token } = getConfig();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(keyId || '') || !token) return STUN;
    try {
      const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 10800 }),
      });
      if (!response.ok) return STUN;
      const { iceServers: servers } = await response.json();
      const relay = (Array.isArray(servers) ? servers : []).flatMap(server => {
        const urls = [server?.urls].flat().filter(url => typeof url === 'string'
          && /^turns?:turn\.cloudflare\.com:(?:80|443|3478|5349)\?transport=(?:udp|tcp)$/.test(url));
        return urls.length && typeof server.username === 'string' && typeof server.credential === 'string'
          ? [{ urls, username: server.username, credential: server.credential }] : [];
      });
      return [...STUN, ...relay];
    } catch {
      return STUN;
    }
  };
}

function createGetReadyLive({ db, secret, iceServers = async () => STUN }) {
  async function start(hostId, body) {
    const sessionId = id(body?.sessionId);
    const title = typeof body.title === 'string' ? body.title.trim() || 'Get Ready With Us' : '';
    if (!title || title.length > 100 || /[\u0000-\u001f]/.test(title)) throw failure(400, 'Use a session title up to 100 characters.');
    const nonce = randomBytes(16).toString('hex');
    const tokenFor = value => createHmac('sha256', secret).update(`get-ready-live\0${hostId}\0${sessionId}\0${value}`).digest('base64url');
    const result = await withActiveMembers(db, [hostId], async (client, members) => {
      await client.query('DELETE FROM get_ready_live_sessions WHERE host_id=$1 AND lease_until<=NOW()', [hostId]);
      const { rows: [row] } = await client.query(`INSERT INTO get_ready_live_sessions AS s
        (id,host_id,title,invite_nonce,invite_hash,lease_until,ends_at) VALUES ($1,$2,$3,$4,$5,NOW()+${LEASE},NOW()+INTERVAL '2 hours')
        ON CONFLICT (host_id) DO UPDATE SET lease_until=LEAST(s.ends_at,NOW()+${LEASE}) WHERE s.id=EXCLUDED.id
        RETURNING s.id,s.title,s.invite_nonce`, [sessionId, hostId, title, nonce, inviteHash(tokenFor(nonce))]);
      if (!row) throw failure(409, 'You already have a live session open. End it before starting another.');
      return { session: sessionInfo({ ...row, host_name: members.get(hostId).name }), inviteToken: tokenFor(row.invite_nonce) };
    });
    return { ...result, iceServers: await iceServers() };
  }

  async function readInvite(client, memberId, token, lock = false) {
    if (typeof token !== 'string' || !INVITE.test(token)) throw failure(404, unavailable);
    const { rows: [row] } = await client.query(`SELECT s.id,s.host_id,s.title,u.name AS host_name
      FROM get_ready_live_sessions s JOIN users u ON u.id=s.host_id
      WHERE s.invite_hash=$1 AND s.lease_until>NOW() AND NOT COALESCE(u.billing_closed,FALSE)
        AND ${unblocked('s.host_id', '$2::uuid')} ${lock ? 'FOR UPDATE OF s' : ''}`, [inviteHash(token), memberId]);
    if (!row) throw failure(404, unavailable);
    if (row.host_id === memberId) throw failure(409, 'Share this invitation with someone else to join your session.');
    return row;
  }

  async function invite(memberId, token) {
    return { session: sessionInfo(await readInvite(db, memberId, token)) };
  }

  async function join(memberId, body) {
    const viewerId = id(body?.viewerId);
    const session = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const room = await readInvite(client, memberId, body.inviteToken, true);
        await client.query(`DELETE FROM get_ready_live_viewers v WHERE v.session_id=$1
          AND (v.lease_until<=NOW() OR (${unblocked('$2::uuid', 'v.member_id')}) IS FALSE)`, [room.id, room.host_id]);
        const { rows: [counts] } = await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE member_id=$2)::int AS existing
          FROM get_ready_live_viewers WHERE session_id=$1`, [room.id, memberId]);
        if (!counts.existing && counts.total >= VIEWER_LIMIT) throw failure(409, 'This live session is full. Try joining again in a moment.');
        await client.query(`INSERT INTO get_ready_live_viewers AS v (session_id,member_id,id,lease_until)
          VALUES ($1,$2,$3,NOW()+${LEASE}) ON CONFLICT (session_id,member_id) DO UPDATE
          SET id=EXCLUDED.id,lease_until=EXCLUDED.lease_until,
            offer=CASE WHEN v.id=EXCLUDED.id THEN v.offer END,answer=CASE WHEN v.id=EXCLUDED.id THEN v.answer END`, [room.id, memberId, viewerId]);
        await client.query('COMMIT');
        return sessionInfo(room);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    return { session, viewerId, iceServers: await iceServers() };
  }

  async function hostSync(hostId, sessionId) {
    const { rows: [row] } = await db.query(`WITH live AS (
      UPDATE get_ready_live_sessions SET lease_until=LEAST(ends_at,NOW()+${LEASE})
      WHERE id=$1 AND host_id=$2 AND lease_until>NOW() RETURNING id,host_id
    ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'offer',v.offer,'answered',v.answer IS NOT NULL))
      FROM get_ready_live_viewers v JOIN users u ON u.id=v.member_id
      WHERE v.session_id=live.id AND v.lease_until>NOW() AND v.offer IS NOT NULL AND NOT COALESCE(u.billing_closed,FALSE)
        AND ${unblocked('live.host_id', 'v.member_id')}), '[]'::jsonb) AS viewers FROM live`, [sessionId, hostId]);
    if (!row) throw failure(404, unavailable);
    return row;
  }

  async function viewerSync(memberId, sessionId, viewerId, body) {
    const offer = body?.offer === undefined ? null : description(body.offer);
    const { rows: [row] } = await db.query(`UPDATE get_ready_live_viewers v
      SET lease_until=NOW()+${LEASE}, offer=COALESCE(v.offer,$4)
      FROM get_ready_live_sessions s JOIN users u ON u.id=s.host_id
      WHERE v.session_id=s.id AND s.id=$1 AND v.id=$2 AND v.member_id=$3 AND s.lease_until>NOW() AND v.lease_until>NOW()
        AND NOT COALESCE(u.billing_closed,FALSE) AND ${unblocked('s.host_id', 'v.member_id')}
        AND ($4::text IS NULL OR v.offer IS NULL OR v.offer=$4) RETURNING v.answer`, [sessionId, viewerId, memberId, offer]);
    if (!row) throw failure(404, unavailable);
    return row;
  }

  async function answer(hostId, sessionId, viewerId, body) {
    const sdp = description(body?.answer);
    const { rowCount } = await db.query(`UPDATE get_ready_live_viewers v SET answer=$4
      FROM get_ready_live_sessions s, users u
      WHERE v.session_id=s.id AND s.id=$1 AND v.id=$2 AND s.host_id=$3 AND v.member_id=u.id
        AND s.lease_until>NOW() AND v.lease_until>NOW() AND v.offer IS NOT NULL AND (v.answer IS NULL OR v.answer=$4)
        AND NOT COALESCE(u.billing_closed,FALSE) AND ${unblocked('s.host_id', 'v.member_id')}`, [sessionId, viewerId, hostId, sdp]);
    if (!rowCount) throw failure(404, unavailable);
  }

  async function end(hostId, sessionId) {
    await db.query('DELETE FROM get_ready_live_sessions WHERE id=$1 AND host_id=$2', [sessionId, hostId]);
  }

  async function leave(memberId, sessionId, viewerId) {
    await db.query('DELETE FROM get_ready_live_viewers WHERE session_id=$1 AND id=$2 AND member_id=$3', [sessionId, viewerId, memberId]);
  }

  async function prune() {
    if (!db.isConnected()) return;
    await db.query('DELETE FROM get_ready_live_sessions WHERE lease_until<=NOW()');
    await db.query('DELETE FROM get_ready_live_viewers WHERE lease_until<=NOW()');
  }

  return { start, invite, join, hostSync, viewerSync, answer, end, leave, prune };
}

function registerGetReadyLiveRoutes(app, { authenticate, limit, live, db }) {
  const prefix = '/get-ready-with-us';
  const rooms = `${prefix}/sessions`;
  const room = `${rooms}/:sessionId`;
  const viewer = `${room}/viewers/:viewerId`;
  app.use(prefix, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

  function respond(handler, status = 200) {
    return async (req, res) => {
      try {
        if (!db.isConnected()) throw failure(503, 'Live sessions are temporarily unavailable.');
        const result = await handler(id(req.user.id), req);
        return status === 204 ? res.status(status).end() : res.status(status).json(result);
      } catch (error) {
        return res.status(error.status || 503).json({ message: error.status ? error.message : 'Live sessions are temporarily unavailable.' });
      }
    };
  }

  app.post(rooms, authenticate, limit, respond((user, req) => live.start(user, req.body), 201));
  app.post(`${prefix}/invite`, authenticate, limit, respond((user, req) => live.invite(user, req.body?.inviteToken)));
  app.post(`${prefix}/join`, authenticate, limit, respond((user, req) => live.join(user, req.body), 201));
  app.post(`${room}/host`, authenticate, respond((user, req) => live.hostSync(user, id(req.params.sessionId))));
  app.put(viewer, authenticate, respond((user, req) => live.viewerSync(user, id(req.params.sessionId), id(req.params.viewerId), req.body)));
  app.put(`${viewer}/answer`, authenticate, respond((user, req) => live.answer(user, id(req.params.sessionId), id(req.params.viewerId), req.body), 204));
  app.delete(room, authenticate, respond((user, req) => live.end(user, id(req.params.sessionId)), 204));
  app.delete(viewer, authenticate, respond((user, req) => live.leave(user, id(req.params.sessionId), id(req.params.viewerId)), 204));
}

module.exports = { GET_READY_LIVE_SCHEMA, createGetReadyLive, createLiveIceServers, registerGetReadyLiveRoutes };
