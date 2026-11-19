'use strict';

const { createHash, hkdfSync, randomBytes, randomUUID } = require('node:crypto');
const { createTokenVault } = require('./token-vault');
const {
  ACTION_MAX_AGE, FIX_MAX_AGE, LEASE_DURATION, ZONE_LIMITS, FOCUS_DURATIONS,
  allowedAction, chooseFocusAction, focusRegions, focusTransitions, applyFocusAction,
  hasPhoneRuleConditions, canStopZonesOnDevice,
} = require('./focus-rules.mjs');

const FOCUS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS focus_settings (
    owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0, config TEXT, session JSONB NOT NULL DEFAULT '{}',
    audio JSONB, audio_until TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS focus_pair_codes (
    owner_id UUID PRIMARY KEY REFERENCES focus_settings(owner_id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE, auth_version INTEGER NOT NULL,
    code_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS focus_devices (
    owner_id UUID PRIMARY KEY REFERENCES focus_settings(owner_id) ON DELETE CASCADE,
    id UUID NOT NULL UNIQUE, session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    auth_version INTEGER NOT NULL, token_hash TEXT UNIQUE NOT NULL, revoke_hash TEXT UNIQUE NOT NULL, platform TEXT NOT NULL,
    zone_sharing BOOLEAN NOT NULL DEFAULT false, precision TEXT, consent_version INTEGER NOT NULL DEFAULT 0,
    confirmation_hash TEXT, confirmation_until TIMESTAMPTZ,
    consent_at TIMESTAMPTZ, lease_until TIMESTAMPTZ, seen_at TIMESTAMPTZ NOT NULL,
    applied_revision INTEGER, registered JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
    sequence INTEGER NOT NULL DEFAULT 0, states TEXT, states_until TIMESTAMPTZ,
    fix TEXT, fix_at TIMESTAMPTZ, fix_until TIMESTAMPTZ
  )`,
  'CREATE INDEX IF NOT EXISTS focus_devices_session_idx ON focus_devices(session_id)',
  'CREATE INDEX IF NOT EXISTS focus_devices_fix_expiry_idx ON focus_devices(fix_until) WHERE fix_until IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS focus_devices_state_expiry_idx ON focus_devices(states_until) WHERE states_until IS NOT NULL',
];

const ZONE_ID = /^[a-z\d][a-z\d_-]{0,99}$/i;
const STATUSES = ['pending', 'monitoring', 'limited', 'permission', 'paused'];
const MANUAL_ACTIONS = ['start', 'startWithSound', 'pauseTimer', 'resetTimer', 'bodyReset', 'endReset', 'quiet', 'quietOff'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
const date = value => new Date(value);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, focusError: true }); };
const invalid = () => fail(400, 'Invalid Focus settings or update.');
const currentTime = value => value ? new Date(value).getTime() : 0;
const emptyScopes = { zones: false, precision: null };

function normalizeConfig(config) {
  const fence = config?.fence;
  if (!config || !Array.isArray(config.zones) || config.zones.length > 250
      || !FOCUS_DURATIONS.includes(config.minutes) || !['selected', 'all', 'individual'].includes(fence?.scope)) invalid();
  if (!hasPhoneRuleConditions(config)) fail(400, 'Review your zones in the latest Office before saving.');
  const unsupportedAction = action => action != null && action !== 'off';
  if (fence.separateExit || fence.fireOnStart || fence.seconds != null || fence.group || fence.cooldownSeconds > 0
      || unsupportedAction(fence.stay) || unsupportedAction(fence.approach)) invalid();
  const seen = new Set();
  const zones = config.zones.map(zone => {
    const { id, name, center, radius, rules } = zone ?? {};
    if (typeof id !== 'string' || !ZONE_ID.test(id) || seen.has(id) || typeof name !== 'string'
        || !Number.isFinite(radius) || radius < 100 || radius >= Math.PI * 6371008.8 || !validFix(center)
        || (zone.shape && zone.shape !== 'circle') || zone.schedule?.enabled || zone.until || zone.snoozedUntil
        || zone.exclude || Object.keys(zone.overrides ?? {}).length
        || unsupportedAction(rules?.stay) || unsupportedAction(rules?.approach)) invalid();
    seen.add(id);
    const normalized = {};
    for (const type of ['enter', 'exit']) {
      if (rules?.[type] == null) continue;
      if (!allowedAction(type, rules[type])) invalid();
      normalized[type] = rules[type];
    }
    return { id, name: name.trim().slice(0, 64), center: {
      latitude: center.latitude, longitude: center.longitude, accuracy: center.accuracy,
    }, radius, enabled: zone.enabled !== false, rules: normalized,
      priority: Number.isSafeInteger(zone.priority) ? Math.min(9, Math.max(0, zone.priority)) : 0 };
  });
  const { enter, exit, scope, profile, custom, combination, duringFocus } = fence;
  if (!allowedAction('enter', enter) || !allowedAction('exit', exit)) invalid();
  const accuracy = Number.isFinite(custom?.maxAccuracy) ? Math.min(1000, Math.max(1, custom.maxAccuracy)) : 150;
  const buffer = Number.isFinite(custom?.buffer) ? Math.min(100, Math.max(0, custom.buffer)) : 10;
  return { zones, activeZoneId: seen.has(config.activeZoneId) ? config.activeZoneId : zones[0]?.id ?? null,
    minutes: config.minutes, fence: { scope, enter, exit, combination, duringFocus,
      profile: ['battery', 'balanced', 'strict', 'precise', 'custom'].includes(profile) ? profile : 'balanced',
      custom: { maxAccuracy: accuracy, buffer, highAccuracy: custom?.highAccuracy !== false } } };
}

function canMonitorZones(config) {
  return hasPhoneRuleConditions(config) && focusRegions(config).length > 0;
}

function configForPhone(config) {
  if (!canMonitorZones(config)) return config;
  // Installed clients can stop locally based on these values. Constrained
  // stop rules are decided by the server, even for older phone builds.
  const allowStop = canStopZonesOnDevice(config);
  const phoneAction = action => action === 'off' || !allowStop && action === 'stopTracking' ? 'status' : action;
  const { fence, zones } = config;
  return { ...config, fence: { ...fence, enter: phoneAction(fence.enter), exit: phoneAction(fence.exit) },
    zones: zones.map(zone => ({ ...zone, rules: { enter: phoneAction(zone.rules.enter), exit: phoneAction(zone.rules.exit) } })) };
}

function duringWorkSession({ deadline, remaining }, observedAt, now) {
  // Remaining stays fixed while running, so this is the start of the current
  // uninterrupted work interval, including when a paused timer was resumed.
  return deadline > now && observedAt >= deadline - remaining * 1000;
}

function validFix(fix) {
  return fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0;
}

function validReport(report, zoneIds, now) {
  return report && Number.isSafeInteger(report.sequence) && report.sequence > 0 && report.sequence <= 2147483647
    && Number.isSafeInteger(report.at) && report.at <= now + 60_000
    && report.states && typeof report.states === 'object' && !Array.isArray(report.states)
    && Object.entries(report.states).every(([id, inside]) => zoneIds.has(id) && typeof inside === 'boolean')
    && Object.keys(report.states).length > 0 && typeof report.baseline === 'boolean';
}

function createFocusSync({ db, encryptionKey, now = Date.now }) {
  const key = encryptionKey && Buffer.from(hkdfSync('sha256', Buffer.from(encryptionKey, 'base64'),
    Buffer.from('uficonnect'), Buffer.from('focus-sync-v1'), 32)).toString('base64');
  const vault = createTokenVault({ OAUTH_TOKEN_ENCRYPTION_KEY: key });
  const seal = (owner, field, value) => vault.seal(json(value), `focus:${owner}:${field}`);
  const open = (owner, field, value) => value ? JSON.parse(vault.open(value, `focus:${owner}:${field}`)) : null;

  async function transaction(operation) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async function settings(client, owner, create = false) {
    if (create) await client.query('INSERT INTO focus_settings (owner_id) VALUES ($1) ON CONFLICT DO NOTHING', [owner]);
    const result = await client.query('SELECT * FROM focus_settings WHERE owner_id=$1 FOR UPDATE', [owner]);
    return result.rows[0];
  }

  async function device(client, owner) {
    const result = await client.query(`SELECT d.*, s.expires_at AS session_until FROM focus_devices d
      JOIN auth_sessions s ON s.id=d.session_id AND s.user_id=d.owner_id
      JOIN users u ON u.id=d.owner_id AND u.auth_version=d.auth_version
      WHERE d.owner_id=$1 AND s.expires_at>$2 AND (d.confirmation_until IS NULL OR d.confirmation_until>$2) FOR UPDATE OF d`, [owner, date(now())]);
    return result.rows[0];
  }

  function scopes(phone) {
    return currentTime(phone.lease_until) > now()
      ? { zones: phone.zone_sharing, precision: phone.precision } : emptyScopes;
  }

  function activeScopes(phone, config) {
    const { zones, precision } = scopes(phone);
    return { zones: zones && canMonitorZones(config), precision };
  }

  function status(row, phone) {
    const config = row && open(row.owner_id, 'config', row.config);
    const sharing = phone && activeScopes(phone, config);
    const leaseUntil = phone && currentTime(phone.lease_until);
    const deviceStatus = phone ? {
      id: phone.id, platform: phone.platform, awaitingConfirmation: Boolean(phone.confirmation_hash), scopes: sharing, seenAt: currentTime(phone.seen_at),
      leaseUntil, appliedRevision: phone.applied_revision, registered: phone.registered,
      status: sharing.zones || sharing.precision ? phone.status : 'paused',
      states: sharing.zones && phone.applied_revision === row.revision && currentTime(phone.states_until) > now()
        ? open(row.owner_id, 'states', phone.states) : null,
      fix: sharing.precision && currentTime(phone.fix_until) > now()
        ? open(row.owner_id, 'fix', phone.fix) : null,
    } : null;
    return { enabled: true, config: config || null, revision: row?.revision ?? 0, phone: deviceStatus,
      zoneReviewRequired: Boolean(config && !hasPhoneRuleConditions(config)),
      session: row?.session ?? {}, audio: deviceStatus?.scopes.zones && currentTime(row?.audio_until) > now() ? row.audio : null };
  }

  function phoneConfig(row, phone) {
    const awaitingConfirmation = Boolean(phone.confirmation_hash);
    const config = awaitingConfirmation ? null : open(row.owner_id, 'config', row.config);
    return { id: phone.id, revision: awaitingConfirmation ? 0 : row.revision,
      config: configForPhone(config), awaitingConfirmation,
      zoneReviewRequired: Boolean(config && !hasPhoneRuleConditions(config)),
      scopes: activeScopes(phone, config), leaseUntil: currentTime(phone.lease_until), consentVersion: phone.consent_version,
      accepted: phone.sequence ?? 0 };
  }

  function withPhone(token, operation) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) fail(401, 'Link this phone again.');
    const digest = hash(token);
    return transaction(async client => {
      const { rows } = await client.query('SELECT owner_id FROM focus_devices WHERE token_hash=$1', [digest]);
      if (!rows[0]) fail(401, 'Link this phone again.');
      const row = await settings(client, rows[0].owner_id);
      const phone = row && await device(client, row.owner_id);
      if (!phone || phone.token_hash !== digest) fail(401, 'Link this phone again.');
      return operation(client, row, phone);
    });
  }

  async function apply(client, row, rule, minutes, at) {
    const result = applyFocusAction(row.session, rule, minutes, at);
    row.session = result.session;
    const command = result.audio ? { id: randomUUID(), action: result.audio, originAction: rule.action, at } : null;
    const clear = rule.action === 'quiet' || rule.action === 'stopTracking';
    await client.query(`UPDATE focus_settings SET session=$2,
      audio=CASE WHEN $5 OR $3::jsonb IS NOT NULL THEN $3::jsonb ELSE audio END,
      audio_until=CASE WHEN $5 OR $3::jsonb IS NOT NULL THEN $4 ELSE audio_until END
      WHERE owner_id=$1`, [row.owner_id, json(result.session), command && json(command), command && date(at + ACTION_MAX_AGE), clear]);
  }

  return {
    read: owner => transaction(async client => {
      const row = await settings(client, owner);
      return status(row, row && await device(client, owner));
    }),

    save: (owner, revision, input) => transaction(async client => {
      const config = normalizeConfig(input);
      const row = await settings(client, owner, true);
      if (row.revision !== revision) fail(409, 'Focus zones changed elsewhere. Refresh before saving.');
      row.config = seal(owner, 'config', config);
      row.revision += 1;
      await client.query('UPDATE focus_settings SET revision=$2, config=$3, audio=NULL, audio_until=NULL WHERE owner_id=$1',
        [owner, row.revision, row.config]);
      row.audio = null;
      return status(row, await device(client, owner));
    }),

    issueCode: (owner, session, version) => transaction(async client => {
      const row = await settings(client, owner, true);
      if (!row.config) fail(409, 'Save your shared zone configuration first.');
      if (await device(client, owner)) fail(409, 'Disconnect the current phone before pairing another.');
      await client.query('DELETE FROM focus_devices WHERE owner_id=$1', [owner]);
      const code = randomBytes(6).toString('hex').toUpperCase();
      const expiresAt = now() + 300_000;
      const inserted = await client.query(`INSERT INTO focus_pair_codes (owner_id, code_hash, expires_at, session_id, auth_version)
        SELECT u.id,$2,$3,s.id,u.auth_version FROM users u JOIN auth_sessions s ON s.user_id=u.id
        WHERE u.id=$1 AND s.id=$4 AND u.auth_version=$5 AND s.expires_at>$6
        ON CONFLICT (owner_id) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at,
          session_id=EXCLUDED.session_id, auth_version=EXCLUDED.auth_version
        RETURNING owner_id`, [owner, hash(code), date(expiresAt), session, version, date(now())]);
      if (!inserted.rows[0]) fail(401, 'Sign in to UFIConnect again.');
      return { code, expiresAt };
    }),

    pair: ({ code, platform } = {}) => transaction(async client => {
      if (!/^[A-Fa-f0-9]{12}$/.test(code || '') || !Object.hasOwn(ZONE_LIMITS, platform)) invalid();
      const digest = hash(code.toUpperCase()), at = date(now());
      const { rows } = await client.query('SELECT owner_id FROM focus_pair_codes WHERE code_hash=$1 AND expires_at>$2', [digest, at]);
      if (!rows[0]) fail(403, 'The Office pairing code is invalid or expired.');
      const owner = rows[0].owner_id;
      const row = await settings(client, owner);
      if (!row?.config || await device(client, owner)) fail(403, 'The Office pairing code is invalid or expired.');
      const claim = await client.query(`DELETE FROM focus_pair_codes WHERE owner_id=$1 AND code_hash=$2 AND expires_at>$3
        RETURNING session_id,auth_version`, [owner, digest, at]);
      if (!claim.rows[0]) fail(403, 'The Office pairing code is invalid or expired.');
      const id = randomUUID(), token = randomBytes(32).toString('hex'), revokeToken = randomBytes(32).toString('hex');
      const confirmation = randomBytes(4).toString('hex').toUpperCase();
      const { session_id: session, auth_version: version } = claim.rows[0];
      await client.query('DELETE FROM focus_devices WHERE owner_id=$1', [owner]);
      const inserted = await client.query(`INSERT INTO focus_devices (owner_id,id,session_id,auth_version,token_hash,revoke_hash,platform,seen_at,confirmation_hash,confirmation_until)
        SELECT u.id,$2,s.id,u.auth_version,$5,$6,$7,$8,$9,$10 FROM users u
        JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$3 AND u.auth_version=$4 AND s.expires_at>$8
        RETURNING id`, [owner, id, session, version, hash(token), hash(revokeToken), platform, at,
        hash(confirmation), date(now() + 300_000)]);
      if (!inserted.rows[0]) fail(403, 'The Office pairing code is invalid or expired.');
      return { id, token, revokeToken, confirmation, awaitingConfirmation: true, config: null, revision: 0,
        scopes: emptyScopes, consentVersion: 0, leaseUntil: 0, accepted: 0 };
    }),

    confirm: (owner, id, confirmation) => transaction(async client => {
      if (typeof id !== 'string' || !/^[a-f0-9]{8}$/i.test(confirmation || '')) invalid();
      const row = await settings(client, owner);
      const phone = row && await device(client, owner);
      if (!phone || phone.id !== id || !phone.confirmation_hash || phone.confirmation_hash !== hash(confirmation.toUpperCase())) {
        fail(403, 'The confirmation code does not match the pending phone.');
      }
      await client.query('UPDATE focus_devices SET confirmation_hash=NULL,confirmation_until=NULL WHERE owner_id=$1', [owner]);
      return status(row, { ...phone, confirmation_hash: null, confirmation_until: null });
    }),

    pull: token => withPhone(token, async (client, row, phone) => {
      const at = now();
      phone.lease_until = (scopes(phone).zones || scopes(phone).precision)
        ? date(Math.min(at + LEASE_DURATION, currentTime(phone.session_until))) : phone.lease_until;
      await client.query('UPDATE focus_devices SET seen_at=$2, lease_until=$3 WHERE owner_id=$1',
        [row.owner_id, date(at), phone.lease_until]);
      return phoneConfig(row, phone);
    }),

    consent: (token, input) => withPhone(token, async (client, row, phone) => {
      if (phone.confirmation_hash) fail(403, 'Confirm this phone in Office before enabling sharing.');
      if (!input || typeof input.zones !== 'boolean' || ![null, 'approximate', 'precise'].includes(input.precision)
          || !Number.isSafeInteger(input.version)) invalid();
      if (input.version !== phone.consent_version) fail(409, 'Focus permission changed. Refresh on this phone.');
      const at = now();
      const granted = scopes(phone);
      if (input.zones) {
        const config = open(row.owner_id, 'config', row.config);
        if (!canMonitorZones(config)) fail(409, 'Review and save phone-compatible zones in Office before enabling geofencing.');
        // Older apps can send a stale zone toggle when changing last-location sharing.
        if (!granted.zones && input.precision !== granted.precision) {
          fail(409, 'Enable zone monitoring separately from sharing your last location.');
        }
      }
      const keepZones = input.zones && granted.zones;
      const keepFix = input.precision && input.precision === granted.precision;
      if (!keepZones) await client.query('UPDATE focus_settings SET audio=NULL, audio_until=NULL WHERE owner_id=$1', [row.owner_id]);
      const result = await client.query(`UPDATE focus_devices SET zone_sharing=$2, precision=$3,
        consent_version=consent_version+1, consent_at=$4, lease_until=$5, seen_at=$4,
        states=CASE WHEN $6 THEN states ELSE NULL END, states_until=CASE WHEN $6 THEN states_until ELSE NULL END,
        registered=CASE WHEN $6 THEN registered ELSE '[]'::jsonb END,
        applied_revision=CASE WHEN $6 THEN applied_revision ELSE NULL END,
        fix=CASE WHEN $7 THEN fix ELSE NULL END, fix_at=CASE WHEN $7 THEN fix_at ELSE NULL END,
        fix_until=CASE WHEN $7 THEN fix_until ELSE NULL END
        WHERE owner_id=$1 RETURNING *`, [row.owner_id, input.zones, input.precision, date(at),
        input.zones || input.precision ? date(Math.min(at + LEASE_DURATION, currentTime(phone.session_until))) : null,
        keepZones, Boolean(keepFix)]);
      return phoneConfig(row, result.rows[0]);
    }),

    report: (token, input) => withPhone(token, async (client, row, phone) => {
      if (phone.confirmation_hash) fail(403, 'Confirm this phone in Office before sending updates.');
      const at = now();
      if (input?.revision !== row.revision || input?.version !== phone.consent_version) {
        fail(409, 'Focus configuration changed. Refresh before sending.');
      }
      const config = open(row.owner_id, 'config', row.config);
      if (!config || !STATUSES.includes(input.status) || !Array.isArray(input.registered)
          || !Array.isArray(input.reports) || input.reports.length > 32) invalid();
      const sharing = activeScopes(phone, config);
      const registered = new Set(input.registered);
      if ((!sharing.zones && (registered.size || input.reports.length)) || (!sharing.precision && input.fix)) {
        fail(403, 'Enable sharing on this phone before sending updates.');
      }
      if (registered.size > ZONE_LIMITS[phone.platform] || registered.size !== input.registered.length
          || ![...registered].every(id => focusRegions(config).some(zone => zone.id === id))
          || !input.reports.every(report => validReport(report, registered, at))) invalid();

      const sameArea = phone.applied_revision === row.revision
        && phone.registered.length === registered.size && phone.registered.every(id => registered.has(id));
      let sequence = phone.sequence, stopped = false;
      let states = sameArea && currentTime(phone.states_until) > at
        ? open(row.owner_id, 'states', phone.states) || {} : {};
      for (const report of input.reports) {
        if (report.sequence <= sequence) continue;
        const baseline = report.baseline || report.sequence !== sequence + 1;
        sequence = report.sequence;
        if (report.at < at - LEASE_DURATION) continue;
        const result = focusTransitions(config, input.registered, states, { ...report, baseline });
        states = result.next;
        if (report.at < at - ACTION_MAX_AGE || !result.events.length
            || (config.fence.duringFocus && !duringWorkSession(row.session, Math.min(report.at, at), at))) continue;
        const rule = chooseFocusAction(config, result.events);
        if (!rule) continue;
        await apply(client, row, rule, config.minutes, at);
        if (rule.action === 'stopTracking') {
          stopped = true;
          break;
        }
      }

      const fixAt = input.fix?.timestamp;
      if (input.fix && (!validFix(input.fix) || !Number.isSafeInteger(fixAt) || fixAt > at + 30_000)) invalid();
      if (input.fix && fixAt > Math.max(at - FIX_MAX_AGE, currentTime(phone.fix_at))
          && (!phone.fix_at || fixAt >= currentTime(phone.fix_at) + 60_000)) {
        const coarse = sharing.precision === 'approximate';
        const round = value => coarse ? Math.round(value * 1000) / 1000 : value;
        const fix = { latitude: round(input.fix.latitude), longitude: round(input.fix.longitude),
          accuracy: Math.max(input.fix.accuracy, coarse ? 150 : 0), timestamp: Math.min(at, fixAt) };
        await client.query('UPDATE focus_devices SET fix=$2,fix_at=$3,fix_until=$4 WHERE owner_id=$1',
          [row.owner_id, seal(row.owner_id, 'fix', fix), date(fix.timestamp), date(fix.timestamp + FIX_MAX_AGE)]);
      }
      if (stopped) {
        const { rows } = await client.query(`UPDATE focus_devices SET zone_sharing=FALSE,consent_version=consent_version+1,
          lease_until=CASE WHEN precision IS NULL THEN NULL ELSE lease_until END,seen_at=$2,
          applied_revision=NULL,registered='[]'::jsonb,status=CASE WHEN precision IS NULL THEN 'paused' ELSE 'pending' END,
          sequence=$3,states=NULL,states_until=NULL WHERE owner_id=$1 RETURNING *`, [row.owner_id, date(at), sequence]);
        return { accepted: sequence, phone: phoneConfig(row, rows[0]) };
      }
      const changed = sequence !== phone.sequence;
      await client.query(`UPDATE focus_devices SET seen_at=$2,applied_revision=$3,registered=$4,status=$5,sequence=$6,
        states=$7,states_until=$8 WHERE owner_id=$1`, [row.owner_id, date(at), row.revision,
        json(input.registered), input.status, sequence,
        changed ? seal(row.owner_id, 'states', states) : sameArea ? phone.states : null,
        changed ? date(at + LEASE_DURATION) : sameArea ? phone.states_until : null]);
      return { accepted: sequence };
    }),

    command: (owner, action) => transaction(async client => {
      if (!MANUAL_ACTIONS.includes(action)) invalid();
      const row = await settings(client, owner);
      if (!row?.config) fail(409, 'Save a shared Focus configuration first.');
      const config = open(owner, 'config', row.config);
      await apply(client, row, { action }, config.minutes, now());
      return { session: row.session };
    }),

    claimAudio: (owner, id) => transaction(async client => {
      const row = await settings(client, owner);
      if (row?.audio?.id !== id || !row?.audio || currentTime(row.audio_until) <= now()) return null;
      const phone = await device(client, owner);
      const config = open(owner, 'config', row.config);
      if (!phone || !activeScopes(phone, config).zones) return null;
      await client.query('UPDATE focus_settings SET audio=NULL, audio_until=NULL WHERE owner_id=$1', [owner]);
      return row.audio;
    }),

    disconnect: (owner, removeConfig = false) => transaction(async client => {
      if (!await settings(client, owner)) return;
      if (removeConfig) await client.query('DELETE FROM focus_settings WHERE owner_id=$1', [owner]);
      else {
        await client.query('DELETE FROM focus_devices WHERE owner_id=$1', [owner]);
        await client.query('DELETE FROM focus_pair_codes WHERE owner_id=$1', [owner]);
        await client.query('UPDATE focus_settings SET audio=NULL, audio_until=NULL WHERE owner_id=$1', [owner]);
      }
    }),

    revoke: token => {
      if (!/^[a-f0-9]{64}$/.test(token || '')) return;
      return transaction(async client => {
        const digest = hash(token);
        const { rows } = await client.query('SELECT owner_id FROM focus_devices WHERE revoke_hash=$1', [digest]);
        if (!rows[0]) return;
        const row = await settings(client, rows[0].owner_id);
        if (!row) return;
        const removed = await client.query('DELETE FROM focus_devices WHERE owner_id=$1 AND revoke_hash=$2 RETURNING id',
          [row.owner_id, digest]);
        if (removed.rows[0]) await client.query('UPDATE focus_settings SET audio=NULL, audio_until=NULL WHERE owner_id=$1', [row.owner_id]);
      });
    },

    async prune() {
      const at = date(now());
      await db.query('DELETE FROM focus_pair_codes WHERE expires_at <= $1', [at]);
      await db.query(`DELETE FROM focus_devices d USING auth_sessions s, users u
        WHERE d.session_id=s.id AND d.owner_id=u.id AND (s.expires_at <= $1 OR d.auth_version <> u.auth_version OR d.confirmation_until <= $1)`, [at]);
      await db.query('UPDATE focus_devices SET fix=NULL,fix_at=NULL,fix_until=NULL WHERE fix_until <= $1', [at]);
      await db.query('UPDATE focus_devices SET states=NULL,states_until=NULL WHERE states_until <= $1', [at]);
      await db.query('UPDATE focus_settings SET audio=NULL,audio_until=NULL WHERE audio_until <= $1', [at]);
    },
  };
}

function registerFocusRoutes(app, { service, enabled, requireOfficeToken, authenticate, limiter }) {
  const privateResponse = (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!enabled()) return res.status(404).json({ message: 'Office phone sync is unavailable.' });
    next();
  };
  app.use(['/office/focus/phone-sync', '/focus/device'], privateResponse, limiter);
  const owner = (req, res, next) => req.user?.sid ? next() : res.status(403).json({ message: 'Sign in to your UFIConnect account again.' });
  const send = handler => async (req, res) => {
    try {
      const result = await handler(req);
      if (result === undefined) return res.sendStatus(204);
      return res.json(result);
    } catch (error) {
      if (!error.focusError) console.warn('[focus] Focus data operation failed.');
      return res.status(error.focusError ? error.status : 503)
        .json({ message: error.focusError ? error.message : 'Focus is temporarily unavailable.' });
    }
  };
  const token = req => /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
  const sameOfficeOwner = (req, res, next) => {
    if (req.method === 'GET' || req.headers['x-ufi-focus-owner'] === req.user.id) return next();
    return res.status(403).json({ message: 'The UFIConnect account changed. Refresh before continuing.' });
  };
  const office = [requireOfficeToken, authenticate, owner, sameOfficeOwner];
  app.get('/office/focus/phone-sync', ...office, send(async req => ({ ...await service.read(req.user.id), ownerId: req.user.id })));
  app.put('/office/focus/phone-sync/config', ...office, send(async req => ({
    ...await service.save(req.user.id, req.body?.revision, req.body?.config), ownerId: req.user.id,
  })));
  app.post('/office/focus/phone-sync/pair', ...office, send(req => service.issueCode(req.user.id, req.user.sid, req.user.ver)));
  app.post('/office/focus/phone-sync/confirm', ...office, send(async req => ({
    ...await service.confirm(req.user.id, req.body?.id, req.body?.confirmation), ownerId: req.user.id,
  })));
  app.delete('/office/focus/phone-sync/phone', ...office, send(req => service.disconnect(req.user.id)));
  app.delete('/office/focus/phone-sync', ...office, send(req => service.disconnect(req.user.id, true)));
  app.post('/office/focus/phone-sync/session', ...office, send(req => service.command(req.user.id, req.body?.action)));
  app.post('/office/focus/phone-sync/audio', ...office, send(req => service.claimAudio(req.user.id, req.body?.id)));
  app.post('/focus/device/pair', send(req => service.pair(req.body ?? {})));
  app.get('/focus/device', send(req => service.pull(token(req))));
  app.patch('/focus/device/consent', send(req => service.consent(token(req), req.body)));
  app.post('/focus/device/report', send(req => service.report(token(req), req.body)));
  app.post('/focus/device/revoke', send(req => service.revoke(token(req))));
}

module.exports = { FOCUS_SCHEMA, createFocusSync, registerFocusRoutes };
