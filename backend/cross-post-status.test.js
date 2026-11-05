'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createCrossPostStatusSynchronizer } = require('./cross-post-status');

const user = { id: 'creator', socialTokens: { youtube: 'private-youtube-token', tiktok: 'private-tiktok-token' } };
const receipt = index => ({ platform: 'youtube', status: 'processing', publishId: `video-${index}`, destinationId: 'own-channel', privacyStatus: 'public' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, { targets = [receipt(1)], count = 1, service = {}, query } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE cross_posts(id text PRIMARY KEY,user_id text,targets jsonb,created_at timestamptz DEFAULT now())');
  for (let index = 0; index < count; index++) await pg.query('INSERT INTO cross_posts(id,user_id,targets) VALUES($1,$2,$3)',
    [`batch-${index}`, user.id, JSON.stringify(count === 1 ? targets : [receipt(index)])]);
  const db = { query: (sql, params) => query ? query(pg, sql, params) : pg.query(sql, params) };
  const publishingTargets = { canSync: platform => platform === 'youtube',
    syncMany: async (_platform, _token, values) => values.map(target => ({ ...target, status: 'posted' })), ...service };
  const synchronize = createCrossPostStatusSynchronizer({ db, publishingTargets,
    fetchTikTokStatus: async (_token, _id, target) => ({ ...target, status: 'posted' }),
    serializeRow: row => ({ id: row.id, targets: row.targets }),
    ...service.options });
  return { pg, synchronize, rows: async () => (await pg.query('SELECT * FROM cross_posts WHERE user_id=$1 ORDER BY id', [user.id])).rows };
}

test('all pending YouTube history rows use one status batch; terminal and unsubmitted receipts are preserved', async t => {
  let reads = 0;
  const f = await fixture(t, { count: 24, service: { async syncMany(platform, token, targets) {
    assert.equal(platform, 'youtube'); assert.equal(token, user.socialTokens.youtube);
    assert.equal(targets.length, 24); reads++;
    return targets.map(target => ({ ...target, status: 'posted', providerStatus: 'processed' }));
  } } });
  await f.pg.query('INSERT INTO cross_posts(id,user_id,targets) VALUES($1,$2,$3)', ['terminal', user.id, JSON.stringify([
    { ...receipt('complete'), status: 'posted' }, { platform: 'youtube', status: 'processing', error: 'Preparing delivery.' },
  ])]);
  const result = await f.synchronize(user, await f.rows());
  assert.equal(reads, 1); assert.equal(result.updated, 24);
  assert.ok(result.posts.filter(row => row.id !== 'terminal').every(row => row.targets[0].status === 'posted'));
  assert.equal(result.posts.find(row => row.id === 'terminal').targets[1].error, 'Preparing delivery.');
  assert.equal(JSON.stringify(result).includes('private-youtube-token'), false);
});

test('simultaneous checks of the same account snapshot share provider work without publishing', async t => {
  const entered = deferred(), release = deferred(); let reads = 0;
  const f = await fixture(t, { service: { async syncMany(_platform, _token, targets) {
    reads++; entered.resolve(); await release.promise; return targets.map(target => ({ ...target, status: 'posted' }));
  }, publish() { throw Error('A status check must never publish.'); } } });
  const rows = await f.rows();
  const first = f.synchronize(user, rows); await entered.promise;
  const second = f.synchronize(user, rows); release.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(reads, 1); assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].posts[0].targets[0].status, 'posted');
});

test('an older poll cannot overwrite a terminal receipt or another platform update', async t => {
  let pg;
  const completed = [{ ...receipt(1), status: 'posted' }, { platform: 'linkedin', status: 'posted', postedUrl: 'https://www.linkedin.com/feed/update/confirmed' }];
  const f = await fixture(t, { targets: [receipt(1), { platform: 'linkedin', status: 'processing' }], service: {
    async syncMany(_platform, _token, targets) {
      await pg.query('UPDATE cross_posts SET targets=$1 WHERE id=$2', [JSON.stringify(completed), 'batch-0']);
      return targets.map(target => ({ ...target, status: 'processing', providerStatus: 'processing' }));
    },
  } });
  pg = f.pg;
  const result = await f.synchronize(user, await f.rows());
  assert.equal(result.updated, 0); assert.deepEqual(result.posts[0].targets, completed);
  assert.deepEqual((await f.rows())[0].targets, completed);
});

test('storage failures keep accepted receipts pending and explain the failed status check', async t => {
  const f = await fixture(t, { query: (pg, sql, params) => {
    if (sql.startsWith('UPDATE cross_posts')) throw Error('Private storage diagnostics');
    return pg.query(sql, params);
  } });
  const result = await f.synchronize(user, await f.rows());
  assert.equal(result.updated, 0); assert.equal(result.posts[0].targets[0].status, 'processing');
  assert.match(result.warnings[0], /could not be saved/); assert.equal(result.retryAfterMs, 30000);
  assert.equal(JSON.stringify(result).includes('Private storage diagnostics'), false);
});

test('expired read credentials renew once with the current account and never repeat a publication', async t => {
  let reads = 0, renewals = 0;
  const f = await fixture(t, { service: {
    async syncMany(_platform, token, targets) {
      reads++; if (token === user.socialTokens.youtube) throw Object.assign(Error('Expired'), { status: 401 });
      assert.equal(token, 'renewed-private-token'); return targets.map(target => ({ ...target, status: 'posted' }));
    },
    options: {
      async refreshAccessToken(id, platform, previous) { assert.equal(id, user.id); assert.equal(platform, 'youtube'); assert.equal(previous, user.socialTokens.youtube); renewals++; return 'renewed-private-token'; },
      async getCurrentUser(id) { assert.equal(id, user.id); return { id, socialTokens: { youtube: 'renewed-private-token' } }; },
    },
  } });
  const result = await f.synchronize(user, await f.rows());
  assert.equal(reads, 2); assert.equal(renewals, 1); assert.equal(result.posts[0].targets[0].status, 'posted');
  assert.equal(JSON.stringify(result).includes('renewed-private-token'), false);
});

test('provider read failures never fabricate failure or publication and offer bounded retry', async t => {
  const f = await fixture(t, { service: { async syncMany() { throw Object.assign(Error('Bearer private-token'), { status: 503 }); } } });
  const result = await f.synchronize(user, await f.rows());
  assert.equal(result.posts[0].targets[0].status, 'processing'); assert.equal(result.updated, 0);
  assert.match(result.warnings[0], /have not been resent/); assert.equal(result.retryAfterMs, 30000);
  assert.equal(JSON.stringify(result).includes('Bearer'), false);
});

test('orphaned preparing receipts become review-required without resending or inventing failure', async t => {
  let reads = 0;
  const f = await fixture(t, { targets: [{ platform: 'youtube', status: 'processing', error: 'Preparing delivery.' }],
    service: { async syncMany() { reads++; throw Error('Unsubmitted targets cannot be checked.'); } } });
  await f.pg.exec("UPDATE cross_posts SET created_at=now()-interval '15 minutes'");
  const result = await f.synchronize(user, await f.rows());
  assert.equal(reads, 0); assert.equal(result.posts[0].targets[0].status, 'handoff');
  assert.equal(result.posts[0].targets[0].deliveryUncertain, true);
  assert.match(result.posts[0].targets[0].error, /Review it at the source/);
});

test('bounded YouTube checks prioritize previously unchecked receipts rather than starving old uploads', async t => {
  const batches = [];
  const f = await fixture(t, { count: 61, service: { async syncMany(_platform, _token, targets) {
    batches.push(targets.map(target => target.publishId)); return targets;
  } } });
  await f.synchronize(user, await f.rows());
  await f.synchronize(user, await f.rows());
  assert.equal(batches[0].length, 50); assert.equal(batches[1].length, 50);
  assert.equal(new Set(batches.flat()).size, 61, 'Every pending receipt receives a check within two bounded rounds');
});
