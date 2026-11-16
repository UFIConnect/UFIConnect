'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');
const { withActiveMembers } = require('./member-write');

const VIEWER_LIMIT = 6;
const REQUEST_LIMIT = 24;
const LEASE = "INTERVAL '55 seconds'";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const INVITE = /^(?:v2\.)?[A-Za-z0-9_-]{43}$/;
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const unavailable = 'This live session has ended or the invitation is unavailable.';
const refreshForApproval = 'Refresh Get Ready With Us to use host approvals.';
const failure = (status, message) => Object.assign(new Error(message), { status });
const inviteHash = token => createHash('sha256').update(token).digest('hex');
const decisions = new Map([
  ['approve', ['pending', 'approved']],
  ['decline', ['pending', 'declined']],
  ['remove', ['approved', 'removed']],
]);

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
  // Existing rooms and viewers can finish with their original access rules.
  'ALTER TABLE get_ready_live_sessions ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE',
  `ALTER TABLE get_ready_live_viewers ADD COLUMN IF NOT EXISTS admission TEXT NOT NULL DEFAULT 'approved'
    CHECK (admission IN ('pending','approved','declined','removed'))`,
];

function unblocked(host, member) {
  return `NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=${host}::text AND b.blocked_id=${member}::text) OR
    (b.blocker_id=${member}::text AND b.blocked_id=${host}::text))`;
}

function sessionInfo(row) {
  return { id: row.id, title: row.title, hostName: row.host_name, viewerLimit: VIEWER_LIMIT, requiresApproval: row.requires_approval };
}

function checkAdmission(admission) {
  if (admission === 'declined') throw failure(403, 'The host declined your request to join.');
  if (admission === 'removed') throw failure(403, 'The host removed you from this session.');
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
    if (body.supportsApproval !== true) throw failure(409, refreshForApproval);
    const title = typeof body.title === 'string' ? body.title.trim() || 'Get Ready With Us' : '';
    if (!title || title.length > 100 || /[\u0000-\u001f]/.test(title)) throw failure(400, 'Use a session title up to 100 characters.');
    const nonce = randomBytes(16).toString('hex');
    // Servers from before host approval must reject links to new rooms.
    const tokenFor = value => `v2.${createHmac('sha256', secret).update(`get-ready-live\0${hostId}\0${sessionId}\0${value}`).digest('base64url')}`;
    const result = await withActiveMembers(db, [hostId], async (client, members) => {
      await client.query('DELETE FROM get_ready_live_sessions WHERE host_id=$1 AND lease_until<=NOW()', [hostId]);
      const { rows: [row] } = await client.query(`INSERT INTO get_ready_live_sessions AS s
        (id,host_id,title,invite_nonce,invite_hash,lease_until,ends_at,requires_approval)
        VALUES ($1,$2,$3,$4,$5,NOW()+${LEASE},NOW()+INTERVAL '2 hours',TRUE)
        ON CONFLICT (host_id) DO UPDATE SET lease_until=LEAST(s.ends_at,NOW()+${LEASE}) WHERE s.id=EXCLUDED.id
        RETURNING s.id,s.title,s.invite_nonce,s.requires_approval`, [sessionId, hostId, title, nonce, inviteHash(tokenFor(nonce))]);
      if (!row) throw failure(409, 'You already have a live session open. End it before starting another.');
      if (!row.requires_approval) throw failure(409, 'End your current live session before starting one with host approvals.');
      return { session: sessionInfo({ ...row, host_name: members.get(hostId).name }), inviteToken: tokenFor(row.invite_nonce) };
    });
    return { ...result, iceServers: await iceServers() };
  }

  async function readInvite(client, memberId, token, lock = false) {
    if (typeof token !== 'string' || !INVITE.test(token)) throw failure(404, unavailable);
    const { rows: [row] } = await client.query(`SELECT s.id,s.host_id,s.title,s.requires_approval,u.name AS host_name,v.admission
      FROM get_ready_live_sessions s JOIN users u ON u.id=s.host_id
      LEFT JOIN get_ready_live_viewers v ON v.session_id=s.id AND v.member_id=$2::uuid
      WHERE s.invite_hash=$1 AND s.lease_until>NOW() AND NOT COALESCE(u.billing_closed,FALSE)
        AND ${unblocked('s.host_id', '$2::uuid')} ${lock ? 'FOR UPDATE OF s' : ''}`, [inviteHash(token), memberId]);
    if (!row) throw failure(404, unavailable);
    if (row.host_id === memberId) throw failure(409, 'Share this invitation with someone else to join your session.');
    return row;
  }

  async function invite(memberId, token) {
    const row = await readInvite(db, memberId, token);
    checkAdmission(row.admission);
    return { session: sessionInfo(row) };
  }

  function roomTransaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  function removeInactiveViewers(client, roomId, hostId) {
    return client.query(`DELETE FROM get_ready_live_viewers v USING users u
      WHERE v.session_id=$1 AND u.id=v.member_id AND v.admission IN ('pending','approved')
        AND (v.lease_until<=NOW() OR COALESCE(u.billing_closed,FALSE) OR NOT ${unblocked('$2::uuid', 'v.member_id')})`, [roomId, hostId]);
  }

  async function join(memberId, body) {
    const viewerId = id(body?.viewerId);
    const result = await roomTransaction(async client => {
      const room = await readInvite(client, memberId, body.inviteToken, true);
      if (room.requires_approval && body.supportsApproval !== true) throw failure(409, refreshForApproval);
      await removeInactiveViewers(client, room.id, room.host_id);
      const { rows: [counts] } = await client.query(`SELECT
        count(*) FILTER (WHERE admission='approved')::int AS approved,
        count(*) FILTER (WHERE admission='pending')::int AS pending,
        max(admission) FILTER (WHERE member_id=$2) AS existing
        FROM get_ready_live_viewers WHERE session_id=$1`, [room.id, memberId]);
      checkAdmission(counts.existing);
      if (!counts.existing && room.requires_approval && counts.pending >= REQUEST_LIMIT) {
        throw failure(409, 'Too many people are waiting to join. Try again in a moment.');
      }
      if (!counts.existing && !room.requires_approval && counts.approved >= VIEWER_LIMIT) {
        throw failure(409, 'This live session is full. Try joining again in a moment.');
      }
      const admission = counts.existing || (room.requires_approval ? 'pending' : 'approved');
      await client.query(`INSERT INTO get_ready_live_viewers AS v (session_id,member_id,id,admission,lease_until)
        VALUES ($1,$2,$3,$4,NOW()+${LEASE}) ON CONFLICT (session_id,member_id) DO UPDATE
        SET id=EXCLUDED.id,lease_until=EXCLUDED.lease_until,
          offer=CASE WHEN v.id=EXCLUDED.id THEN v.offer END,answer=CASE WHEN v.id=EXCLUDED.id THEN v.answer END`, [room.id, memberId, viewerId, admission]);
      return { session: sessionInfo(room), viewerId, admission };
    });
    return result.admission === 'approved' ? { ...result, iceServers: await iceServers() } : result;
  }

  async function decideAdmission(hostId, sessionId, viewerId, decision) {
    const transition = decisions.get(decision);
    if (!transition) throw failure(400, 'Choose whether to admit, decline, or remove the guest.');
    const [before, after] = transition;
    await roomTransaction(async client => {
      const { rows: [room] } = await client.query(`SELECT ends_at FROM get_ready_live_sessions
        WHERE id=$1 AND host_id=$2 AND lease_until>NOW() FOR UPDATE`, [sessionId, hostId]);
      if (!room) throw failure(404, unavailable);
      await removeInactiveViewers(client, sessionId, hostId);
      const { rows: [viewer] } = await client.query(`SELECT admission FROM get_ready_live_viewers
        WHERE session_id=$1 AND id=$2 AND lease_until>NOW() FOR UPDATE`, [sessionId, viewerId]);
      if (!viewer) throw failure(404, 'This guest is no longer in the session.');
      if (viewer.admission === after) return;
      if (viewer.admission !== before) throw failure(409, 'This guest’s access has already changed.');
      if (after === 'approved') {
        const { rows: [count] } = await client.query(`SELECT count(*)::int AS total FROM get_ready_live_viewers
          WHERE session_id=$1 AND admission='approved'`, [sessionId]);
        if (count.total >= VIEWER_LIMIT) throw failure(409, 'The session is full. Wait for a viewer to leave or remove someone to admit this guest.');
      }
      await client.query(`UPDATE get_ready_live_viewers SET admission=$3, offer=NULL, answer=NULL,
        lease_until=CASE WHEN $3='approved' THEN NOW()+${LEASE} ELSE $4 END
        WHERE session_id=$1 AND id=$2`, [sessionId, viewerId, after, room.ends_at]);
    });
  }

  async function hostSync(hostId, sessionId) {
    const { rows: [row] } = await db.query(`WITH live AS (
      UPDATE get_ready_live_sessions SET lease_until=LEAST(ends_at,NOW()+${LEASE})
      WHERE id=$1 AND host_id=$2 AND lease_until>NOW() RETURNING id,host_id
    ) SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'offer',v.offer,'answered',v.answer IS NOT NULL))
        FILTER (WHERE v.admission='approved' AND v.offer IS NOT NULL), '[]'::jsonb) AS viewers,
      COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'admission',v.admission) ORDER BY v.name,v.id)
        FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS guests
      FROM live LEFT JOIN LATERAL (
        SELECT v.id,v.offer,v.answer,v.admission,u.name FROM get_ready_live_viewers v JOIN users u ON u.id=v.member_id
        WHERE v.session_id=live.id AND v.lease_until>NOW() AND v.admission IN ('pending','approved')
          AND NOT COALESCE(u.billing_closed,FALSE) AND ${unblocked('live.host_id', 'v.member_id')}
      ) v ON TRUE GROUP BY live.id`, [sessionId, hostId]);
    if (!row) throw failure(404, unavailable);
    return row;
  }

  async function viewerSync(memberId, sessionId, viewerId, body) {
    const offer = body?.offer === undefined ? null : description(body.offer);
    const { rows: [row] } = await db.query(`UPDATE get_ready_live_viewers v
      SET lease_until=CASE WHEN v.admission IN ('pending','approved') THEN NOW()+${LEASE} ELSE v.lease_until END,
        offer=CASE WHEN v.admission='approved' THEN COALESCE(v.offer,$4) END
      FROM get_ready_live_sessions s JOIN users u ON u.id=s.host_id, users member
      WHERE v.session_id=s.id AND s.id=$1 AND v.id=$2 AND v.member_id=$3 AND s.lease_until>NOW() AND v.lease_until>NOW()
        AND member.id=v.member_id AND NOT COALESCE(member.billing_closed,FALSE)
        AND NOT COALESCE(u.billing_closed,FALSE) AND ${unblocked('s.host_id', 'v.member_id')}
        AND ($4::text IS NULL OR v.admission<>'approved' OR v.offer IS NULL OR v.offer=$4)
      RETURNING v.admission,CASE WHEN v.admission='approved' THEN v.answer END AS answer`, [sessionId, viewerId, memberId, offer]);
    if (!row) throw failure(404, unavailable);
    checkAdmission(row.admission);
    return row;
  }

  async function answer(hostId, sessionId, viewerId, body) {
    const sdp = description(body?.answer);
    const { rowCount } = await db.query(`UPDATE get_ready_live_viewers v SET answer=$4
      FROM get_ready_live_sessions s, users u
      WHERE v.session_id=s.id AND s.id=$1 AND v.id=$2 AND s.host_id=$3 AND v.member_id=u.id
        AND s.lease_until>NOW() AND v.lease_until>NOW() AND v.admission='approved' AND v.offer IS NOT NULL AND (v.answer IS NULL OR v.answer=$4)
        AND NOT COALESCE(u.billing_closed,FALSE) AND ${unblocked('s.host_id', 'v.member_id')}`, [sessionId, viewerId, hostId, sdp]);
    if (!rowCount) throw failure(404, unavailable);
  }

  async function end(hostId, sessionId) {
    await db.query('DELETE FROM get_ready_live_sessions WHERE id=$1 AND host_id=$2', [sessionId, hostId]);
  }

  async function leave(memberId, sessionId, viewerId) {
    await db.query(`DELETE FROM get_ready_live_viewers WHERE session_id=$1 AND id=$2 AND member_id=$3
      AND admission IN ('pending','approved')`, [sessionId, viewerId, memberId]);
  }

  async function prune() {
    if (!db.isConnected()) return;
    await db.query('DELETE FROM get_ready_live_sessions WHERE lease_until<=NOW()');
    await db.query('DELETE FROM get_ready_live_viewers WHERE lease_until<=NOW()');
  }

  return { start, invite, join, decideAdmission, hostSync, viewerSync, answer, end, leave, prune };
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
  app.put(`${viewer}/admission`, authenticate, limit, respond((user, req) => live.decideAdmission(user, id(req.params.sessionId), id(req.params.viewerId), req.body?.decision), 204));
  app.put(`${viewer}/answer`, authenticate, respond((user, req) => live.answer(user, id(req.params.sessionId), id(req.params.viewerId), req.body), 204));
  app.delete(room, authenticate, respond((user, req) => live.end(user, id(req.params.sessionId)), 204));
  app.delete(viewer, authenticate, respond((user, req) => live.leave(user, id(req.params.sessionId), id(req.params.viewerId)), 204));
}

module.exports = { GET_READY_LIVE_SCHEMA, createGetReadyLive, createLiveIceServers, registerGetReadyLiveRoutes };
