'use strict';

// Recovery runs only as an authorized maintenance operation. The source
// database returns anonymous category/day totals, never paths or identities.
const catalog = require('./analytics-categories.json');
const pages = [...new Map(Object.values(catalog).filter(page => ['page', 'screen'].includes(page.viewType))
  .map(page => [page.path, { path: page.path, category: page.category }])).values()];
const LEGACY_PAGEVIEW_CATALOG = JSON.stringify([...pages,
  { path: '/global-scroll', category: 'global' },
  { path: '/hq', category: 'command_center' },
  { path: '/agents', category: 'command_center' },
  { path: '/how-office-works', category: 'how_it_works' },
]);
const LEGACY_PAGEVIEW_QUERY = `WITH policy AS (
  SELECT path,category FROM jsonb_to_recordset($3::jsonb) AS page(path TEXT,category TEXT)
), cleaned AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
    regexp_replace(regexp_replace(path,'[?#].*$',''),'^/UFIConnect(?=/|$)','','i') AS path
  FROM page_views WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
), normalized AS (
  SELECT day,COALESCE(NULLIF(regexp_replace(path,'/$',''),''),'/') AS path
  FROM cleaned WHERE path NOT LIKE '%\\%%' ESCAPE '\\'
), classified AS (
  SELECT day,COALESCE(policy.category,CASE
    WHEN normalized.path ~ '^/groups/[^/]+$' THEN 'group'
    WHEN normalized.path ~ '^/opportunities/[^/]+$' THEN 'opportunity'
    WHEN normalized.path ~ '^/messages/[^/]+$' THEN 'conversation'
    WHEN normalized.path ~ '^/p/[^/]+$' THEN 'post'
    WHEN normalized.path ~ '^/u/[^/]+$' THEN 'member'
    WHEN normalized.path ~ '^/centers/[^/]+$' THEN 'workspace_center'
    ELSE NULL END) AS category
  FROM normalized LEFT JOIN policy ON policy.path=normalized.path
  WHERE normalized.path !~* '^/(vault|auth|oauth|vpn)(/|$)'
    AND normalized.path !~* '^/app/vpn(/|$)'
)
SELECT day::text,category,COUNT(*)::bigint AS event_count FROM classified
WHERE category IS NOT NULL GROUP BY day,category ORDER BY day,category`;

const HISTORY_ANALYTICS_UPSERT = `INSERT INTO analytics_history_daily_counts(source,day,category,event_count)
  SELECT $1::text,day,category,event_count FROM jsonb_to_recordset($2::jsonb)
  AS incoming(day DATE,category TEXT,event_count BIGINT)
  ON CONFLICT(source,day,category) DO UPDATE SET event_count=EXCLUDED.event_count`;
const HISTORY_REGISTRATION_UPSERT = `INSERT INTO registration_history_daily_counts(source,day,event_count)
  SELECT 'database_backup_20261008',day,event_count FROM jsonb_to_recordset($1::jsonb)
  AS incoming(day DATE,event_count BIGINT)
  ON CONFLICT(source,day) DO UPDATE SET event_count=EXCLUDED.event_count`;

module.exports = { LEGACY_PAGEVIEW_CATALOG, LEGACY_PAGEVIEW_QUERY, HISTORY_ANALYTICS_UPSERT, HISTORY_REGISTRATION_UPSERT };
