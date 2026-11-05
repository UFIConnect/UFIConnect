'use strict';

const START = '2026-05-01';
const unavailableActivity = () => ({ available: false, mode: 'aggregate', error: 'Tracked activity is temporarily unavailable.' });
const unavailableTraffic = () => ({ available: false, source: 'cloudflare-zone-http', status: 'unavailable', error: 'Provider traffic is temporarily unavailable.' });

function createAnalyticsOverview({ aggregateAnalytics, trafficAnalytics, now = Date.now } = {}) {
  let pending = null;
  async function snapshot() {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (pending?.day === today) return pending.promise;
    const operation = { day: today };
    operation.promise = (async () => {
      // Source snapshots own their cache, verification and provider limits.
      // Do not cache this envelope: an acknowledged activity write must be
      // visible as soon as its source invalidates the canonical snapshot.
      const results = await Promise.allSettled([
        Promise.resolve().then(() => aggregateAnalytics.snapshot({ detail: 'compact' })),
        Promise.resolve().then(() => trafficAnalytics.snapshot()),
      ]);
      const activityValue = results[0].status === 'fulfilled' ? results[0].value : null;
      const trafficValue = results[1].status === 'fulfilled' ? results[1].value : null;
      const activity = activityValue?.available === true && activityValue.mode === 'aggregate'
        && Array.isArray(activityValue.categories) && Array.isArray(activityValue.daily)
        ? activityValue : unavailableActivity();
      const traffic = trafficValue?.available === true && trafficValue.source === 'cloudflare-zone-http'
        && Array.isArray(trafficValue.daily) ? trafficValue : unavailableTraffic();
      const count = Number(activity.available) + Number(traffic.available);
      return { available: count > 0, mode: 'overview', status: count === 2 ? 'ready' : count ? 'partial' : 'unavailable',
        range: { from: START, to: today, timezone: 'UTC' }, generatedAt: new Date(now()).toISOString(),
        activity, traffic,
        sources: {
          activity: { available: activity.available, status: activity.available ? activity.verification?.status || 'loaded' : 'unavailable',
            checkedAt: activity.snapshot?.checkedAt || activity.generatedAt || null,
            firstRecordedDay: activity.history?.firstRecordedDay || null,
            maximumAgeMs: activity.snapshot?.maximumAgeMs || null,
            scope: 'Retained page, screen and tab opens. Repeat opens count; these totals do not identify unique people.',
            ...(!activity.available ? { error: activity.error } : {}) },
          traffic: { available: traffic.available, status: traffic.status,
            checkedAt: traffic.checkedAt || null, lastSuccessAt: traffic.lastSuccessAt || traffic.generatedAt || null,
            firstRecordedDay: traffic.coverage?.firstRecordedDay || null,
            maximumAgeMs: traffic.cache?.ttlMs || null,
            scope: 'Provider HTTP traffic includes automated requests, assets and API traffic. HTML views differ from tracked app opens.',
            ...(!traffic.available ? { error: traffic.error } : {}) },
        },
        definitions: { comparison: 'Traffic and tracked opens are independent observations. Never add them together or interpret their ratio as a conversion rate.',
          unknown: 'Dates outside a source coverage window or absent from its observations are unavailable, not zero traffic.',
          visitors: 'This overview does not establish unique people. Daily unique IP counts are not added together.' },
      };
    })();
    pending = operation;
    try { return await operation.promise; } finally { if (pending === operation) pending = null; }
  }
  async function report(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (Object.keys(req.query || {}).length) return res.status(400).json({ available: false, error: 'Overview dates and source coverage are selected from the shared report in Office.' });
    const result = await snapshot();
    return res.status(result.available ? 200 : 503).json(result);
  }
  return { report, snapshot };
}

module.exports = { createAnalyticsOverview };
