'use strict';

const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { BUSINESS_ACCOUNT_SCHEMA, accountTypeOf, businessRegistrationMessage } = require('./business-enrollment');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fault = (status, message) => Object.assign(new Error(message), { status });
const emailOf = value => String(value || '').trim().toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');
const capacity = owner => owner?.plan === 'business' && accountTypeOf(owner) === 'business' && !owner.billing_closed
  ? Math.max(1, Math.min(100, Number(owner.business_seats) || 1)) : 0;

const BUSINESS_TEAM_SCHEMA = [
  ...BUSINESS_ACCOUNT_SCHEMA,
  `CREATE TABLE IF NOT EXISTS business_team_members (
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, member_id), CHECK (owner_id <> member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS business_team_invitations (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (owner_id, invitee_id), CHECK (owner_id <> invitee_id)
  )`,
  `CREATE INDEX IF NOT EXISTS business_team_invitations_invitee ON business_team_invitations(invitee_id)`,
  `UPDATE users SET account_type='business' WHERE business_enrollment_cutoff IS NOT NULL
    AND EXISTS(SELECT 1 FROM business_team_members m WHERE m.member_id=users.id)`,
];

function createBusinessTeams({ db, billing, now = Date.now }) {
  function ready(id) {
    if (!db.isConnected()) throw fault(503, 'Team membership storage is temporarily unavailable.');
    if (!UUID.test(String(id || ''))) throw fault(400, 'A registered account is required to manage a team.');
  }
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  async function lockAccounts(client, ids) {
    // Stable lock order also protects account deletion and parallel acceptance.
    const { rows } = await client.query('SELECT id,name,email,organization,plan,account_type,business_seats,billing_closed FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    return rows;
  }
  async function memberRows(client, ownerId) {
    return (await client.query(`SELECT m.member_id AS id,u.name,u.email,m.joined_at AS "joinedAt"
      FROM business_team_members m JOIN users u ON u.id=m.member_id
      WHERE m.owner_id=$1 ORDER BY m.joined_at,m.member_id`, [ownerId])).rows;
  }
  async function ownsTeamRecords(client, userId) {
    // Call while holding this user's account lock, which is also required by
    // invitations, acceptance, removal and revocation. Cancellation alone
    // does not remove the team records its owner still needs to manage.
    const { rows: [result] } = await client.query(`SELECT
      EXISTS(SELECT 1 FROM business_team_members WHERE owner_id=$1)
      OR EXISTS(SELECT 1 FROM business_team_invitations WHERE owner_id=$1 AND expires_at>$2) AS owned`,
    [userId, new Date(now())]);
    return result.owned;
  }
  async function effectiveMembership(userId) {
    ready(userId);
    // Recompute the rank against the owner's paid capacity on every check.
    // Reductions/cancellations cannot leave cached team access behind.
    const { rows: [seat] } = await db.query(`SELECT m.owner_id AS "ownerId",u.name AS "ownerName",u.organization,
      u.plan,u.account_type,u.business_seats,u.billing_closed,
      (SELECT COUNT(*)::int FROM business_team_members earlier WHERE earlier.owner_id=m.owner_id
       AND (earlier.joined_at,earlier.member_id) <= (m.joined_at,m.member_id)) AS position
      FROM business_team_members m JOIN users u ON u.id=m.owner_id WHERE m.member_id=$1`, [userId]);
    if (!seat) return null;
    return { ownerId: seat.ownerId, ownerName: seat.ownerName, organization: seat.organization || '',
      active: seat.position < capacity(seat), seats: capacity(seat) };
  }
  async function list(userId) {
    ready(userId);
    const { rows: [self] } = await db.query('SELECT id,name,email,organization,plan,account_type,business_seats,billing_closed FROM users WHERE id=$1', [userId]);
    if (!self || self.billing_closed) throw fault(404, 'Account not found.');
    const members = await memberRows(db, userId);
    const invitations = (await db.query(`SELECT i.id,u.name,i.email,i.expires_at AS "expiresAt"
      FROM business_team_invitations i JOIN users u ON u.id=i.invitee_id
      WHERE i.owner_id=$1 AND i.expires_at>$2 ORDER BY i.created_at,i.id`, [userId, new Date(now())])).rows;
    if (capacity(self) || members.length || invitations.length) {
      const seats = capacity(self);
      return { role: 'owner', active: seats > 0, seats, used: seats ? 1 + Math.min(members.length, seats - 1) : 0,
        owner: { id: self.id, name: self.name, organization: self.organization || '' },
        members: members.map((member, index) => ({ ...member, active: index + 1 < seats })), invitations };
    }
    const membership = await effectiveMembership(userId);
    return membership ? { role: 'member', ...membership } : { role: 'none', active: false, seats: 0 };
  }
  async function invite(ownerId, value) {
    ready(ownerId);
    if (!value || Object.keys(value).some(key => key !== 'email') || typeof value.email !== 'string'
      || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) {
      throw fault(400, 'Enter the email address of a registered teammate.');
    }
    await billing.status(ownerId);
    const email = emailOf(value.email);
    const { rows: [target] } = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [email]);
    if (!target) throw fault(400, 'Ask this person to register with this email before inviting them.');
    if (target.id === ownerId) throw fault(400, 'Your membership already includes your own seat.');
    return transaction(async client => {
      const accounts = await lockAccounts(client, [ownerId, target.id]);
      const owner = accounts.find(row => row.id === ownerId);
      const invitee = accounts.find(row => row.id === target.id);
      if (capacity(owner) < 2) throw fault(403, 'An active Business membership for two or more people is required to invite teammates.');
      if (!invitee || invitee.billing_closed || emailOf(invitee.email) !== email) throw fault(400, 'This registered account is no longer available.');
      if (accountTypeOf(invitee) !== 'business') throw fault(403, 'The teammate needs a Business account created from public Business registration. Personal accounts cannot join Business teams.');
      if (invitee.plan === 'business') throw fault(409, 'This person already manages a Business membership.');
      if (await ownsTeamRecords(client, target.id)) throw fault(409, 'This person must remove their team members and revoke pending invitations in Settings before joining another team.');
      const { rows: existingMember } = await client.query('SELECT owner_id FROM business_team_members WHERE member_id=$1', [target.id]);
      if (existingMember.length) throw fault(409, 'This person must leave their current team before accepting another invitation.');
      await client.query('DELETE FROM business_team_invitations WHERE owner_id=$1 AND expires_at<=$2', [ownerId, new Date(now())]);
      const { rows: [count] } = await client.query(`SELECT
        (SELECT COUNT(*)::int FROM business_team_members WHERE owner_id=$1) AS members,
        (SELECT COUNT(*)::int FROM business_team_invitations WHERE owner_id=$1 AND invitee_id<>$2) AS pending`, [ownerId, target.id]);
      if (Number(count.members) + Number(count.pending) >= capacity(owner) - 1) throw fault(409, 'All paid seats are assigned or reserved. Remove a member or invitation, or add seats in Manage billing.');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + 7 * 24 * 60 * 60 * 1000);
      const { rows: [invitation] } = await client.query(`INSERT INTO business_team_invitations(id,owner_id,invitee_id,email,token_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,invitee_id) DO UPDATE SET
        email=EXCLUDED.email,token_hash=EXCLUDED.token_hash,created_at=NOW(),expires_at=EXCLUDED.expires_at
        RETURNING id,email,expires_at AS "expiresAt"`, [randomUUID(), ownerId, target.id, email, hash(token), expiresAt]);
      return { invitation, invitePath: `/recruiting#invite=${token}` };
    });
  }
  async function accept(userId, value) {
    ready(userId);
    if (!value || Object.keys(value).some(key => key !== 'token') || !/^[A-Za-z0-9_-]{43}$/.test(value.token || '')) throw fault(400, 'This invitation link is invalid.');
    const tokenHash = hash(value.token);
    const { rows: [target] } = await db.query('SELECT owner_id,invitee_id FROM business_team_invitations WHERE token_hash=$1', [tokenHash]);
    if (!target || target.invitee_id !== userId) throw fault(404, 'This invitation is unavailable for your signed-in account.');
    await billing.status(target.owner_id);
    return transaction(async client => {
      const accounts = await lockAccounts(client, [target.owner_id, userId]);
      const owner = accounts.find(row => row.id === target.owner_id);
      const invitee = accounts.find(row => row.id === userId);
      const { rows: [invitation] } = await client.query('SELECT * FROM business_team_invitations WHERE token_hash=$1 FOR UPDATE', [tokenHash]);
      if (!invitation || invitation.invitee_id !== userId || new Date(invitation.expires_at).getTime() <= now()
        || !invitee || invitee.billing_closed || emailOf(invitee.email) !== invitation.email) throw fault(404, 'This invitation has expired or is unavailable for your account.');
      if (capacity(owner) < 2) throw fault(403, 'This team does not currently have an active membership for two or more people.');
      if (accountTypeOf(invitee) !== 'business') throw fault(403, businessRegistrationMessage);
      if (invitee.plan === 'business') throw fault(409, 'Leave or cancel your own Business membership before joining another team.');
      if (await ownsTeamRecords(client, userId)) throw fault(409, 'Remove your team members and revoke pending invitations in Settings before joining another team.');
      const { rows: existing } = await client.query('SELECT owner_id FROM business_team_members WHERE member_id=$1', [userId]);
      if (existing.length) throw fault(409, 'You already belong to a team. Leave it before accepting another invitation.');
      const { rows: [count] } = await client.query('SELECT COUNT(*)::int AS total FROM business_team_members WHERE owner_id=$1', [owner.id]);
      if (count.total >= capacity(owner) - 1) throw fault(409, 'This team has no available paid seat. Ask its owner to add a seat.');
      await client.query('INSERT INTO business_team_members(owner_id,member_id) VALUES($1,$2)', [owner.id, userId]);
      await client.query('DELETE FROM business_team_invitations WHERE invitee_id=$1', [userId]);
      return { joined: true, owner: { id: owner.id, name: owner.name, organization: owner.organization || '' } };
    });
  }
  async function inspectInvitation(userId, value) {
    ready(userId);
    if (!value || Object.keys(value).some(key => key !== 'token') || !/^[A-Za-z0-9_-]{43}$/.test(value.token || '')) throw fault(400, 'This invitation link is invalid.');
    const { rows: [invitation] } = await db.query(`SELECT i.email,i.expires_at AS "expiresAt",u.id,u.name,u.organization,
      u.plan,u.account_type,u.business_seats,u.billing_closed
      FROM business_team_invitations i JOIN users u ON u.id=i.owner_id JOIN users recipient ON recipient.id=i.invitee_id
      WHERE i.token_hash=$1 AND i.invitee_id=$2 AND i.expires_at>$3
        AND LOWER(recipient.email)=i.email AND recipient.billing_closed=false`, [hash(value.token), userId, new Date(now())]);
    if (!invitation) throw fault(404, 'This invitation has expired or is unavailable for your signed-in account.');
    return { owner: { id: invitation.id, name: invitation.name, organization: invitation.organization || '' },
      email: invitation.email, expiresAt: invitation.expiresAt, active: capacity(invitation) >= 2 };
  }
  async function remove(ownerId, memberId) {
    ready(ownerId);
    if (!UUID.test(String(memberId || ''))) throw fault(400, 'Choose a team member.');
    await transaction(async client => {
      await lockAccounts(client, [ownerId, memberId]);
      await client.query('DELETE FROM business_team_members WHERE owner_id=$1 AND member_id=$2', [ownerId, memberId]);
    });
    return { removed: true };
  }
  async function revoke(ownerId, invitationId) {
    ready(ownerId);
    if (!UUID.test(String(invitationId || ''))) throw fault(400, 'Choose an invitation.');
    await transaction(async client => {
      await lockAccounts(client, [ownerId]);
      await client.query('DELETE FROM business_team_invitations WHERE owner_id=$1 AND id=$2', [ownerId, invitationId]);
    });
    return { removed: true };
  }
  async function leave(userId) {
    ready(userId);
    const { rows: [member] } = await db.query('SELECT owner_id FROM business_team_members WHERE member_id=$1', [userId]);
    if (member) await transaction(async client => {
      await lockAccounts(client, [member.owner_id, userId]);
      await client.query('DELETE FROM business_team_members WHERE member_id=$1', [userId]);
    });
    return { left: true };
  }
  return { list, invite, accept, inspectInvitation, remove, revoke, leave, effectiveMembership };
}

function registerBusinessTeamRoutes(app, { teams, authenticate, limiter }) {
  const respond = action => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await action(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Team membership is temporarily unavailable. Please try again.' }); }
  };
  const gates = limiter ? [authenticate, limiter] : [authenticate];
  app.get('/business/team', ...gates, respond(req => teams.list(req.user.id)));
  app.post('/business/team/invitations', ...gates, respond(req => teams.invite(req.user.id, req.body)));
  app.post('/business/team/invitation', ...gates, respond(req => teams.inspectInvitation(req.user.id, req.body)));
  app.post('/business/team/accept', ...gates, respond(req => teams.accept(req.user.id, req.body)));
  app.delete('/business/team/invitations/:id', ...gates, respond(req => teams.revoke(req.user.id, req.params.id)));
  app.delete('/business/team/members/:id', ...gates, respond(req => teams.remove(req.user.id, req.params.id)));
  app.post('/business/team/leave', ...gates, respond(req => teams.leave(req.user.id)));
}

module.exports = { BUSINESS_TEAM_SCHEMA, createBusinessTeams, registerBusinessTeamRoutes };
