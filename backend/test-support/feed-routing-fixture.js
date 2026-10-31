'use strict';
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { REPORT_SCHEMA } = require('../content-reports');
const { OFFICE_TOPIC_SCHEMA } = require('../office-topic-transfer');
const routingModule = require('../topic-routing-agents');
const auditModule = require('../feed-audit');
const { createAppHarness } = require('./app-harness');

// Exercise the actual feed writers and routing SQL on the same transaction.
// Ancillary telemetry has separate fixtures and is intentionally not stored.
async function createFeedRoutingFixture(t, { beforeQuery = async () => {} } = {}) {
  const pg = new PGlite();
  const entry = fs.readFileSync(require.resolve('../index'), 'utf8');
  const tables = new Set(['feed_posts_cache', 'feed_posts_staging', 'feed_posts_archive']);
  const migration = entry.slice(entry.indexOf('async function migrateDB()'), entry.indexOf('// --- Save external posts'));
  for (const match of migration.matchAll(/await db\.query\(`([\s\S]*?)`\)/g)) {
    const sql = match[1].trim();
    const table = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1] || /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS/.exec(sql)?.[1];
    if (tables.has(table)) await pg.exec(sql);
  }
  for (const sql of REPORT_SCHEMA.filter(sql => sql.includes('report_content_suppressions'))) await pg.exec(sql);
  for (const sql of OFFICE_TOPIC_SCHEMA) await pg.exec(sql);
  let service, audit, tail = Promise.resolve();
  const app = await createAppHarness({ connected: true,
    modules: {
      './topic-routing-agents': { ...routingModule, createTopicRoutingAgents: options => (service = routingModule.createTopicRoutingAgents(options)) },
      './feed-audit': { ...auditModule, createFeedAudit: (db, options) => (audit = auditModule.createFeedAudit(db, options)) },
    },
    withClient: (work, query) => {
      const result = tail.then(() => work({ query })); tail = result.catch(() => {}); return result;
    },
    query: async (sql, params) => {
      await beforeQuery(sql, params);
      if (/feed_posts_(?:cache|staging|archive)|report_content_suppressions|office_feed_|office_topic_/.test(sql)
        || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        const result = await pg.query(sql, params.map(value => typeof value?.toISOString === 'function' ? value.toISOString() : value));
        return { ...result, rowCount: result.affectedRows };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  t.after(async () => { await app.close(); await pg.close(); });
  await service.initialize(); await audit.initialize();
  return { pg, app, service, audit };
}
module.exports = { createFeedRoutingFixture };
