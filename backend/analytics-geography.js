'use strict';

const { ISO_COUNTRY_CODES, trustedFeedNetworkLocation } = require('./feed-location');
const countries = new Set(ISO_COUNTRY_CODES);
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function place(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return /^[\p{L}\p{M}\p{N}\s.'’(),/-]{1,80}$/u.test(normalized) ? normalized : '';
}

function analyticsGeography(req, env = process.env) {
  // Reuse the feed's verified proxy chain. Country/city are coarse network
  // labels; neither device coordinates nor request IPs enter analytics.
  const location = trustedFeedNetworkLocation(req, { visitorLocationHeaders: env.CF_VISITOR_LOCATION_HEADERS === 'true' });
  if (!countries.has(location.country)) return { country: '', city: '', region: '' };
  return { country: location.country, city: place(location.city), region: place(location.region) };
}

const CITY_LIMIT = 1000;
const count = value => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(value) || 0));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function createGeographyReportHandler({ db, catalog, now = Date.now, env = process.env }) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const query = req.query || {}, today = new Date(now()).toISOString().slice(0, 10);
    const from = query.from || '2026-05-01', to = query.to || today;
    const platform = query.platform || 'all', category = query.category || 'all', viewType = query.viewType || 'all';
    if (!validDay(from) || !validDay(to) || from < '2026-05-01' || from > to || to > today
      || !['all', 'web', 'mobile'].includes(platform) || !['all', 'page', 'screen', 'tab'].includes(viewType)
      || (category !== 'all' && (typeof category !== 'string' || !Object.hasOwn(catalog, category)))) {
      return res.status(400).json({ available: false, error: 'Choose valid dates, platform, category and view type for geographic counts.' });
    }
    const selected = Object.values(catalog).filter(row => (platform === 'all' || row.platform === platform)
      && (category === 'all' || row.category === category) && (viewType === 'all' || row.viewType === viewType)).map(row => row.category);
    if (!db.isConnected()) return res.status(503).json({ available: false, error: 'Geographic counts are temporarily unavailable.' });
    try {
      // Aggregate on the database, rather than returning day × category × city
      // history. Country totals are complete; city details are bounded with an
      // exact remaining count. All totals use the same statement snapshot.
      const { rows: [row] } = await db.query(`WITH matching AS (
        SELECT day, country, city, region, event_count FROM analytics_geography_daily_counts
        WHERE day >= $1::date AND day <= $2::date AND category=ANY($3::text[])
      ), country_counts AS (
        SELECT country, SUM(event_count)::bigint AS views FROM matching GROUP BY country
      ), city_counts AS (
        SELECT country, MIN(city) AS city, MIN(region) AS region, SUM(event_count)::bigint AS views
        FROM matching WHERE city<>'' GROUP BY country, lower(city), lower(region)
      ), top_cities AS (
        SELECT * FROM city_counts ORDER BY views DESC, country, city, region LIMIT ${CITY_LIMIT}
      ), page_counts AS (
        SELECT event_count FROM analytics_daily_counts WHERE day >= $1::date AND day <= $2::date
          AND category=ANY($3::text[]) AND kind='page_view' AND code=''
        UNION ALL
        SELECT event_count FROM analytics_history_daily_counts WHERE day >= $1::date AND day <= $2::date AND category=ANY($3::text[])
      ) SELECT
        (SELECT COALESCE(SUM(event_count),0) FROM page_counts) AS total,
        (SELECT COALESCE(SUM(views),0) FROM country_counts) AS known_country,
        (SELECT COALESCE(SUM(views),0) FROM city_counts) AS known_city,
        (SELECT COUNT(*) FROM city_counts) AS city_count,
        (SELECT COALESCE(SUM(views),0) FROM top_cities) AS shown_city_views,
        (SELECT MIN(day)::text FROM matching) AS first_recorded_day,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('country',country,'views',views) ORDER BY views DESC,country) FROM country_counts),'[]'::jsonb) AS countries,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('country',country,'city',city,'region',region,'views',views) ORDER BY views DESC,country,city,region) FROM top_cities),'[]'::jsonb) AS cities`,
      [from, to, selected]);
      const total = count(row.total), knownCountry = count(row.known_country), knownCity = count(row.known_city);
      return res.json({ available: true, source: 'verified-network-location', unit: 'views',
        range: { from, to }, filters: { platform, category, viewType }, generatedAt: new Date(now()).toISOString(),
        cityHeadersEnabled: env.CF_VISITOR_LOCATION_HEADERS === 'true', firstRecordedDay: row.first_recorded_day,
        total, knownCountry, knownCity, unknownCountry: Math.max(0, total - knownCountry), unknownCity: Math.max(0, total - knownCity),
        cityLimit: CITY_LIMIT, cityCount: count(row.city_count), otherCityViews: Math.max(0, knownCity - count(row.shown_city_views)),
        countries: row.countries.map(entry => ({ country: entry.country, label: countryNames.of(entry.country) || entry.country, views: count(entry.views) })),
        cities: row.cities.map(entry => ({ country: entry.country, countryName: countryNames.of(entry.country) || entry.country,
          city: entry.city, region: entry.region, key: JSON.stringify([entry.country, entry.region, entry.city]), views: count(entry.views) })),
        definition: 'Approximate network country and city for recorded opens. Repeat views count; these are not unique people or profile locations. Missing and older location data is unknown.',
      });
    } catch {
      return res.status(503).json({ available: false, error: 'Geographic counts are temporarily unavailable.' });
    }
  };
}

module.exports = { analyticsGeography, createGeographyReportHandler, CITY_LIMIT };
