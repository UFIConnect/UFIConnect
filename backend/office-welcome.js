'use strict';

const { memoryRedactor } = require('./office-ai-memory');
const MINUTE = 60000, DAY = 86400000;
const keys = ['past24h', 'today', 'week'];
const iso = value => new Date(value).toISOString();
const count = value => {
  if (value === null || value === undefined || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('Invalid count snapshot');
  return Number(value);
};
const timestamp = value => value && Number.isFinite(new Date(value).getTime()) ? iso(value) : null;

function welcomeWindows(now = Date.now(), timeZone = 'UTC') {
  if (typeof timeZone !== 'string' || timeZone.length > 80) throw new RangeError('Choose a valid time zone.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = at => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  // Find the beginning of the local calendar date directly. This also handles
  // midnight offset changes and 23/25-hour DST days without a fixed UTC offset.
  const startOfDate = date => {
    const utc = Date.parse(date + 'T00:00:00Z');
    let left = (utc - 36 * 3600000) / MINUTE, right = (utc + 36 * 3600000) / MINUTE;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (localDate(middle * MINUTE) < date) left = middle + 1; else right = middle;
    }
    return left * MINUTE;
  };
  const at = Math.floor(Number(now) / MINUTE) * MINUTE;
  const date = localDate(at), calendar = new Date(date + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() - (calendar.getUTCDay() + 6) % 7);
  const asOf = iso(at);
  return { timeZone: formatter.resolvedOptions().timeZone, asOf,
    windows: { past24h: { from: iso(at - DAY), to: asOf }, today: { from: iso(startOfDate(date)), to: asOf },
      week: { from: iso(startOfDate(calendar.toISOString().slice(0, 10))), to: asOf } } };
}

function createOfficeWelcome({ db, memory, analytics, env = process.env, serviceRole = 'api', now = Date.now } = {}) {
  const redact = memoryRedactor(env);
  const text = (value, maximum = 180) => typeof value === 'string' ? redact(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
  const available = () => Boolean(db?.isConnected?.());
  const attempt = async callback => {
    try { return available() ? { ok: true, value: await callback() } : { ok: false }; } catch { return { ok: false }; }
  };
  async function readSummary({ timeZone = 'UTC' } = {}) {
    const generatedAt = iso(now()), timing = welcomeWindows(Date.parse(generatedAt), timeZone), { windows, asOf } = timing;
    const starts = keys.map(key => windows[key].from), earliest = starts.reduce((a, b) => a < b ? a : b);
    const params = [...starts, asOf, earliest];
    const totals = column => keys.map((key, index) => `COUNT(*) FILTER (WHERE ${column} >= $${index + 1}::timestamptz) AS "${key}"`).join(',');
    const tableCounts = async (table, column, condition = 'TRUE') => {
      const { rows } = await db.query(`SELECT ${totals(column)} FROM ${table} WHERE ${column} >= $5::timestamptz AND ${column} < $4::timestamptz AND ${condition}`, params);
      if (!rows[0]) throw new Error('Missing count snapshot');
      return Object.fromEntries(keys.map(key => [key, count(rows[0][key])]));
    };
    const memberPromise = attempt(() => tableCounts('community_posts', 'created_at', "COALESCE(source,'uficonnect')='uficonnect'"));
    const importedPromise = attempt(() => tableCounts('feed_posts_cache', 'post_created_at', "COALESCE(source,'')<>'uficonnect'"));
    const usersPromise = attempt(async () => {
      const { rows } = await db.query("SELECT to_regclass('registration_history_date_corrections') AS corrections");
      if (!rows[0]) throw new Error('Missing registration metadata');
      const corrections = Boolean(rows[0]?.corrections);
      // Restored historical accounts can have a recent restoration timestamp.
      // Exclude known earlier registrations instead of counting them as new.
      const condition = corrections ? `NOT EXISTS (SELECT 1 FROM registration_history_date_corrections correction
        WHERE correction.user_id=u.id AND correction.registered_day<(u.created_at AT TIME ZONE 'UTC')::date)` : 'TRUE';
      return { counts: await tableCounts('users u', 'u.created_at', condition), registrationCorrections: corrections ? 'applied' : 'not-recorded' };
    });
    const warningServerPromise = attempt(async () => {
      const { rows } = await db.query('SELECT COUNT(*) AS count FROM server_error_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz', [windows.past24h.from, asOf]);
      return count(rows[0]?.count);
    });
    const warningControlsPromise = attempt(async () => {
      const { rows } = await db.query("SELECT COUNT(*) AS count FROM office_control_runs WHERE status='failed' AND COALESCE(finished_at,started_at) >= $1::timestamptz AND COALESCE(finished_at,started_at) < $2::timestamptz", [windows.past24h.from, asOf]);
      return count(rows[0]?.count);
    });
    const criticalActivityPromise = attempt(async () => {
      // Severity and time are non-payload columns. No conversations or anomaly
      // evidence need to be decrypted to count recorded critical findings.
      const { rows } = await db.query(`SELECT COUNT(*) AS count FROM office_ai_memory WHERE scope='office' AND deleted_at IS NULL
        AND kind='note' AND mode='activity' AND status='critical' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`, [windows.past24h.from, asOf]);
      return count(rows[0]?.count);
    });
    const latestControlPromise = attempt(async () => {
      const { rows } = await db.query(`SELECT control_label,status,COALESCE(finished_at,started_at) AS at FROM office_control_runs
        WHERE COALESCE(finished_at,started_at)<=$1::timestamptz ORDER BY COALESCE(finished_at,started_at) DESC,id DESC LIMIT 1`, [generatedAt]);
      const row = rows[0];
      return row ? { kind: 'control', label: text(row.control_label) || 'Office control', status: text(row.status, 48), at: timestamp(row.at) } : null;
    });
    const latestTaskPromise = attempt(async () => {
      // Project only a short label. Never allocate task history, files or media.
      const { rows } = await db.query(`SELECT LEFT(data->>'message',500) AS message,status,updated_at AS at FROM office_ai_tasks
        WHERE updated_at<=$1::timestamptz ORDER BY updated_at DESC,id DESC LIMIT 1`, [generatedAt]);
      const row = rows[0];
      return row ? { kind: 'task', label: text(row.message) || 'Office task', status: text(row.status, 48), at: timestamp(row.at) } : null;
    });
    const latestMemoryPromise = attempt(async () => {
      if (!memory?.get) throw new Error('Memory unavailable');
      // Select one relevant record before decrypting; skip files and anomaly notes.
      const { rows } = await db.query(`SELECT id FROM office_ai_memory WHERE scope='office' AND deleted_at IS NULL
        AND (kind='execution' OR (kind='conversation' AND role='user')) AND created_at<=$1::timestamptz
        ORDER BY created_at DESC,id DESC LIMIT 1`, [generatedAt]);
      if (!rows[0]) return null;
      const entry = await memory.get(rows[0].id);
      return entry && !entry.deleted ? { kind: entry.kind, label: text(entry.title || (entry.role === 'user' ? entry.content : 'Recorded Office execution')),
        status: text(entry.status, 48), at: timestamp(entry.createdAt) } : null;
    });
    const analyticsPromise = (async () => {
      try { return await analytics.welcomeSnapshot({ windows, asOf }); }
      catch { return { available: false, asOf, reason: 'Analytics storage unavailable.', windows: {} }; }
    })();
    const [member, imported, users, serverWarnings, controlWarnings, criticalActivity, latestControl, latestTask, latestMemory, analyticsSnapshot] = await Promise.all([
      memberPromise, importedPromise, usersPromise, warningServerPromise, warningControlsPromise, criticalActivityPromise, latestControlPromise, latestTaskPromise, latestMemoryPromise, analyticsPromise]);
    const sources = { memberPosts: member.ok ? 'available' : 'unavailable', importedPosts: imported.ok ? 'available' : 'unavailable', newUsers: users.ok ? 'available' : 'unavailable' };
    const counts = Object.fromEntries(keys.map(key => [key, { posts: { memberCreated: member.ok ? member.value[key] : null,
      importedRetained: imported.ok ? imported.value[key] : null }, newUsers: users.ok ? users.value.counts[key] : null }]));
    const activitySources = { memory: latestMemory.ok ? 'available' : 'unavailable', controls: latestControl.ok ? 'available' : 'unavailable', tasks: latestTask.ok ? 'available' : 'unavailable' };
    const latest = [latestMemory.value, latestControl.value, latestTask.value].filter(item => item?.at).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
    return { schemaVersion: 1, generatedAt, ...timing, counts, sources,
      definitions: { memberCreated: 'Member posts currently retained, counted by creation time.', importedRetained: 'Imported feed posts currently retained, counted by original publication time; not an ingestion total.',
        newUsers: 'Current registered accounts, counted by creation time; known restored historical registrations are excluded.', registrationCorrections: users.ok ? users.value.registrationCorrections : 'unavailable',
        week: 'Monday through the latest completed minute in the selected time zone.' },
      analytics: analyticsSnapshot,
      warnings: { available: [serverWarnings, controlWarnings, criticalActivity].every(source => source.ok && source.value !== null), serverErrors: serverWarnings.ok ? serverWarnings.value : null,
        failedControls: controlWarnings.ok ? controlWarnings.value : null, criticalActivityFindings: criticalActivity.ok ? criticalActivity.value : null, ...windows.past24h,
        coverage: { scope: 'Available durable records', exhaustive: false, serverErrors: serverWarnings.ok ? 'available' : 'unavailable',
          failedControls: controlWarnings.ok ? 'available' : 'unavailable', criticalActivityFindings: criticalActivity.ok ? 'available' : 'unavailable',
          note: 'Missing, expired, forgotten or unrecorded events cannot be reported. Server errors and failed controls have no severity classification.' },
        scope: 'Recorded critical Office activity findings, server errors and failed Office controls. These records do not establish that all serious warnings were captured.' },
      lastActivity: { available: Object.values(activitySources).some(value => value === 'available'), complete: Object.values(activitySources).every(value => value === 'available'),
        scope: 'Shared Office activity', latest, sources: activitySources } };
  }
  async function report(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (serviceRole !== 'api') return res.status(409).json({ error: 'The welcome summary is reported by the API service.' });
    try { return res.json(await readSummary({ timeZone: req.query?.timeZone ?? 'UTC' })); }
    catch (error) { return res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'Choose a valid IANA time zone.' : 'The welcome summary is unavailable.' }); }
  }
  return { readSummary, report };
}

module.exports = { welcomeWindows, createOfficeWelcome };
