'use strict';

const { createHash } = require('node:crypto');
const DAY = 86400000;
const START = '2026-05-01';
const ZONE = 'uficonnect.org';
const TTL = 300000;
const MAX_DAYS = 400;
const MAX_HISTORY_DAYS = 4000;
const MAX_BYTES = 512 * 1024;
const TRAFFIC_ANALYTICS_SCHEMA = `CREATE TABLE IF NOT EXISTS traffic_analytics_daily_counts (
  source TEXT NOT NULL CHECK(source='cloudflare-zone-http'),
  zone TEXT NOT NULL CHECK(zone='uficonnect.org'),
  day DATE NOT NULL CHECK(day >= DATE '2026-05-01'),
  requests BIGINT NOT NULL CHECK(requests BETWEEN 0 AND 9007199254740991),
  page_views BIGINT NOT NULL CHECK(page_views BETWEEN 0 AND 9007199254740991),
  threats BIGINT NOT NULL CHECK(threats BETWEEN 0 AND 9007199254740991),
  unique_ips BIGINT NOT NULL CHECK(unique_ips BETWEEN 0 AND 9007199254740991),
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source,zone,day)
)`;
const DEFINITIONS = Object.freeze({
  requests: 'Cloudflare HTTP requests for this zone, including assets, API traffic and automated requests.',
  pageViews: 'Cloudflare HTML page requests. These can include automated traffic and differ from in-app page, screen and tab opens.',
  uniqueIPs: 'Unique client IP addresses within each UTC day. IPs can repeat on different days and do not identify unique people.',
  uniqueVisitors: 'Unavailable. Daily unique IP counts are never added together as unique visitors.',
  comparison: 'Cloudflare traffic and in-app opens have different coverage and must not be added together.',
});
const DOCUMENTATION = [
  'https://developers.cloudflare.com/analytics/faq/about-analytics/',
  'https://developers.cloudflare.com/analytics/graphql-api/features/data-sets/',
];
const problem = code => Object.assign(new Error('Cloudflare traffic metrics are unavailable.'), { code });
const dayOf = instant => new Date(instant).toISOString().slice(0, 10);
const count = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw problem('invalid_response');
  return value;
};
function add(target, key, value) {
  const total = target[key] + value;
  if (!Number.isSafeInteger(total)) throw problem('invalid_response');
  target[key] = total;
}
function summarize(rows, range, maxDays = MAX_DAYS) {
  if (!Array.isArray(rows) || rows.length > maxDays) throw problem('invalid_response');
  const daily = [], seen = new Set(), months = new Map();
  const totals = { requests: 0, pageViews: 0, threats: 0, uniqueVisitors: null };
  for (const row of rows) {
    const day = row?.dimensions?.date;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || !Number.isFinite(Date.parse(day)) || dayOf(Date.parse(day)) !== day
        || day < range.from || day > range.to || seen.has(day)) throw problem('invalid_response');
    seen.add(day);
    const entry = { day, requests: count(row.sum?.requests), pageViews: count(row.sum?.pageViews),
      threats: count(row.sum?.threats), uniqueIPs: count(row.uniq?.uniques) };
    daily.push(entry);
    const month = day.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, recordedDays: 0, requests: 0, pageViews: 0, threats: 0, uniqueVisitors: null });
    const monthly = months.get(month); monthly.recordedDays++;
    for (const key of ['requests', 'pageViews', 'threats']) { add(totals, key, entry[key]); add(monthly, key, entry[key]); }
  }
  daily.sort((a, b) => a.day.localeCompare(b.day));
  const missingDays = [];
  for (let date = Date.parse(range.from); date <= Date.parse(range.to); date += DAY) {
    const day = dayOf(date); if (!seen.has(day)) missingDays.push(day);
  }
  return { totals, daily, monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    coverage: { requestedFrom: START, firstRecordedDay: daily[0]?.day || null, lastRecordedDay: daily.at(-1)?.day || null,
      observedDays: daily.length, requestedDays: daily.length + missingDays.length, missingDays,
      complete: missingDays.length === 0 && range.from === START,
      rangeLimited: range.from !== START,
      note: 'Dates absent from the provider response are unobserved; they are not asserted to have zero traffic. The current UTC day is partial.' } };
}

function createTrafficAnalytics({ db, env = process.env, refreshConnections = async () => {}, fetcher = fetch, now = Date.now } = {}) {
  let cache = null, failed = null, inFlight = null;
  const historyRange = to => ({ from: dayOf(Math.max(Date.parse(START), Date.parse(to) - (MAX_HISTORY_DAYS - 1) * DAY)), to, timezone: 'UTC' });
  async function history(provider, range, observedAt) {
    const persisted = [], persistence = { status: db ? 'unavailable' : 'not_configured', durable: false, storedDays: 0, recoveredDays: 0, latestPersistedAt: null };
    if (db?.isConnected?.()) {
      persistence.status = 'ready';
      if (provider?.daily.length) {
        try {
          // Exact provider snapshots replace their own daily values. Retries and
          // overlapping date windows cannot add a second copy of traffic.
          await db.query(`INSERT INTO traffic_analytics_daily_counts AS saved
            (source,zone,day,requests,page_views,threats,unique_ips,observed_at)
            SELECT 'cloudflare-zone-http','uficonnect.org',day,requests,page_views,threats,unique_ips,$2::timestamptz
            FROM jsonb_to_recordset($1::jsonb)
            AS incoming(day DATE,requests BIGINT,page_views BIGINT,threats BIGINT,unique_ips BIGINT) WHERE TRUE
            ON CONFLICT(source,zone,day) DO UPDATE SET requests=EXCLUDED.requests,page_views=EXCLUDED.page_views,
              threats=EXCLUDED.threats,unique_ips=EXCLUDED.unique_ips,observed_at=EXCLUDED.observed_at
            WHERE saved.observed_at <= EXCLUDED.observed_at`,
          [JSON.stringify(provider.daily.map(row => ({ day: row.day, requests: row.requests, page_views: row.pageViews, threats: row.threats, unique_ips: row.uniqueIPs }))), observedAt]);
        } catch { persistence.status = 'write_failed'; }
      }
      try {
        const result = await db.query(`SELECT day::text,requests,page_views,threats,unique_ips,observed_at
          FROM traffic_analytics_daily_counts WHERE source=$1 AND zone=$2 AND day >= $3::date AND day <= $4::date
          ORDER BY day LIMIT ${MAX_HISTORY_DAYS}`, ['cloudflare-zone-http', ZONE, range.from, range.to]);
        for (const row of result.rows) {
          const timestamp = new Date(row.observed_at).toISOString();
          if (!persistence.latestPersistedAt || timestamp > persistence.latestPersistedAt) persistence.latestPersistedAt = timestamp;
          persisted.push({ dimensions: { date: row.day }, sum: { requests: count(Number(row.requests)), pageViews: count(Number(row.page_views)),
            threats: count(Number(row.threats)) }, uniq: { uniques: count(Number(row.unique_ips)) } });
        }
        // Validate all stored rows before allowing them into an authoritative
        // report, including date bounds, duplicates, and integer precision.
        summarize(persisted, range, MAX_HISTORY_DAYS);
        persistence.storedDays = persisted.length;
        persistence.durable = persistence.status === 'ready';
      } catch { persisted.length = 0; persistence.status = 'read_failed'; persistence.latestPersistedAt = null; }
    }
    const merged = new Map(persisted.map(row => [row.dimensions.date, row]));
    const freshDays = new Set(provider?.daily.map(row => row.day) || []);
    persistence.recoveredDays = persisted.filter(row => !freshDays.has(row.dimensions.date)).length;
    for (const row of provider?.daily || []) merged.set(row.day, { dimensions: { date: row.day },
      sum: { requests: row.requests, pageViews: row.pageViews, threats: row.threats }, uniq: { uniques: row.uniqueIPs } });
    const summary = summarize([...merged.values()], range, MAX_HISTORY_DAYS);
    summary.coverage.providerObservedDays = freshDays.size;
    summary.coverage.persistedDays = persistence.storedDays;
    summary.coverage.recoveredDays = persistence.recoveredDays;
    persistence.note = persistence.durable
      ? 'Anonymous daily provider totals are preserved independently of provider retention. Returned dates replace exact values; missing dates never delete stored history.'
      : 'Traffic can be displayed, but durable history storage is unavailable or incomplete. Previously observed days may be unavailable after restart.';
    return { range, ...(provider ? { providerRange: provider.range } : {}), ...summary, persistence };
  }
  async function json(url, token, body) {
    let response;
    try {
      response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`,
        Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(12000) });
    } catch { throw problem('source_unavailable'); }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw problem([401, 403].includes(response.status) ? 'permissions_required' : response.status === 429 ? 'rate_limited' : 'source_unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw problem('invalid_response');
    let bytes = 0; const chunks = [];
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) throw problem('response_too_large');
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw problem('invalid_response'); }
  }
  async function collect(config, range) {
    const zones = await json(`https://api.cloudflare.com/client/v4/zones?name=${ZONE}&per_page=5`, config.token);
    if (zones.success !== true || !Array.isArray(zones.result) || zones.result.length !== 1) throw problem('zone_unavailable');
    const zone = zones.result[0];
    if (zone.name !== ZONE || !/^[a-f0-9]{32}$/i.test(zone.id || '')
        || zone.account?.id !== config.accountId) throw problem('zone_unavailable');
    const query = `query Traffic($zone: string, $from: Date, $to: Date) { viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1dGroups(limit: ${MAX_DAYS}, filter: {date_geq: $from, date_leq: $to}, orderBy: [date_ASC]) {
        dimensions { date } sum { requests pageViews threats } uniq { uniques }
      }
    } } }`;
    const data = await json('https://api.cloudflare.com/client/v4/graphql', config.token,
      { query, variables: { zone: zone.id, from: range.from, to: range.to } });
    if (data.errors?.length || !Array.isArray(data.data?.viewer?.zones) || data.data.viewer.zones.length !== 1) throw problem('source_unavailable');
    return { range, ...summarize(data.data.viewer.zones[0].httpRequests1dGroups, range) };
  }
  async function snapshot() {
    const checkedAt = new Date(now()).toISOString();
    const base = { source: 'cloudflare-zone-http', zone: ZONE, checkedAt, definitions: DEFINITIONS, documentation: DOCUMENTATION };
    const unavailable = reason => ({ ...base, available: false, status: 'unavailable',
      error: 'Cloudflare traffic metrics are unavailable. Check the saved Cloudflare connection and Zone Analytics Read permissions.', reason });
    try { await refreshConnections(); }
    catch { cache = null; failed = null; return unavailable('connection_unavailable'); }
    const config = { token: env.CLOUDFLARE_API_TOKEN || '', accountId: env.CLOUDFLARE_ACCOUNT_ID || '' };
    if (!/^[\x21-\x7e]{20,4096}$/.test(config.token) || !/^[a-f0-9]{32}$/i.test(config.accountId)) {
      cache = null; failed = null; return unavailable('configuration_missing');
    }
    const to = dayOf(now()), from = dayOf(Math.max(Date.parse(START), Date.parse(to) - (MAX_DAYS - 1) * DAY));
    const range = { from, to, timezone: 'UTC' };
    const key = createHash('sha256').update(JSON.stringify([config.token, config.accountId, from, to])).digest('hex');
    if (cache?.key !== key) cache = null;
    if (failed?.key !== key) failed = null;
    const respond = (entry, status) => ({ ...base, ...entry.data, available: true, status,
      generatedAt: entry.fetchedAt, lastSuccessAt: entry.fetchedAt,
      cache: { ttlMs: TTL, ageMs: Math.max(0, now() - entry.savedAt) },
      ...(status === 'stale' ? { reason: failed?.reason || 'source_unavailable', error: 'Provider refresh failed. Showing previously observed traffic with its original timestamp.' } : {}) });
    if (failed && now() < failed.retryAt) return cache ? respond(cache, 'stale') : unavailable(failed.reason);
    if (cache && now() - cache.savedAt < TTL) return respond(cache, 'cached');
    if (!inFlight || inFlight.key !== key) {
      const operation = { key };
      operation.promise = collect(config, range).then(async provider => {
        const fetchedAt = new Date(now()).toISOString();
        const data = await history(provider, historyRange(to), fetchedAt);
        return { key, data, savedAt: now(), fetchedAt };
      });
      inFlight = operation;
    }
    const operation = inFlight;
    try {
      const entry = await operation.promise;
      if (config.token !== (env.CLOUDFLARE_API_TOKEN || '') || config.accountId !== (env.CLOUDFLARE_ACCOUNT_ID || '')) return unavailable('connection_changed');
      if (inFlight === operation) { cache = entry; failed = null; }
      return respond(entry, 'fresh');
    } catch (error) {
      const reason = ['permissions_required', 'rate_limited', 'source_unavailable', 'response_too_large', 'invalid_response', 'zone_unavailable'].includes(error.code) ? error.code : 'source_unavailable';
      if (config.token !== (env.CLOUDFLARE_API_TOKEN || '') || config.accountId !== (env.CLOUDFLARE_ACCOUNT_ID || '')) return unavailable('connection_changed');
      if (inFlight === operation) failed = { key, reason, retryAt: now() + TTL };
      if (cache?.key === key) return respond(cache, 'stale');
      let stored;
      try { stored = await history(null, historyRange(to)); }
      catch { return unavailable('invalid_response'); }
      if (stored.daily.length && stored.persistence.latestPersistedAt) {
        const entry = { key, data: stored, savedAt: Date.parse(stored.persistence.latestPersistedAt), fetchedAt: stored.persistence.latestPersistedAt };
        if (inFlight === operation) cache = entry;
        return respond(entry, 'stale');
      }
      return unavailable(reason);
    } finally { if (inFlight === operation) inFlight = null; }
  }
  async function report(req, res) {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query || {}).length) return res.status(400).json({ error: 'Traffic reports use the configured UFIConnect domain and date range.' });
    const result = await snapshot();
    return res.status(result.available ? 200 : 503).json(result);
  }
  return { report, snapshot };
}

module.exports = { createTrafficAnalytics, TRAFFIC_ANALYTICS_SCHEMA };
