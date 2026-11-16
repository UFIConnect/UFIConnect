'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createUnknownTopicReview } = require('./unknown-topic-review');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

async function hold(pg, id, sourceUrl = `https://example.org/${id}`) {
  const post = { id, title: 'Python automation', content: 'A tutorial about Python.',
    source: 'reddit', source_url: sourceUrl, fetched_at: new Date().toISOString() };
  await pg.query('INSERT INTO office_unknown_topic_review(post_id,post) VALUES($1,$2)', [id, JSON.stringify(post)]);
}

test('confirmed assignment resumes on a new process and commits its cursor with the post batch', async t => {
  let fail = false;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (fail && sql.includes('SET progress=$2,remaining=$3')) throw Object.assign(new Error('Fixture retry'), { code: '40001' });
  } });
  const newService = () => createUnknownTopicReview({db:f.app.db, topics:['Python']});
  const first = newService();
  await first.initialize();
  for (let i = 0; i < 105; i++) await hold(f.pg, `review-${i}`);
  const items = [];
  let cursor;
  do {
    const page = await first.list({limit:50,...(cursor ? {cursor} : {})});
    items.push(...page.items.map(({id,version}) => ({id,expectedVersion:version})));
    cursor = page.nextCursor;
  } while (cursor);
  const input = {id:randomUUID(),items,topic:'Python',confirmed:true};
  const started = await first.startAssignment(input);
  assert.equal(started.remaining,105);
  assert.equal((await first.startAssignment(input)).id,started.id);
  await assert.rejects(first.startAssignment({...input,id:randomUUID()}),{status:409});
  fail = true;
  await first.sweepJobs();
  assert.equal((await first.listJobs()).assignment.remaining,105);
  assert.equal((await first.listJobs()).pending,0);
  fail = false;
  await first.sweepJobs();
  assert.equal((await first.listJobs()).assignment.remaining,5);
  assert.equal((await first.listJobs()).pending,100);
  await f.pg.query("UPDATE office_unknown_topic_review SET post=post || '{\"content\":\"Changed since selection\"}'::jsonb WHERE post_id=$1", [items.at(-1).id]);

  // A replacement API process sweeps the saved selection without a browser.
  const replacement = newService();
  await replacement.initialize();
  await replacement.sweepJobs();
  const { assignment, pending } = await replacement.listJobs();
  assert.equal(assignment.status,'complete');
  assert.equal(assignment.progress.assigned,104);
  assert.equal(assignment.progress.conflicts,1);
  assert.equal(pending,104);
  assert.equal((await replacement.detail(items.at(-1).id)).item.pending,true);

  const fresh = await replacement.detail(items.at(-1).id);
  const stopped = await replacement.startAssignment({...input,id:randomUUID(),items:[{id:fresh.item.id,expectedVersion:fresh.item.version}]});
  await replacement.stopJob(stopped.id);
  await replacement.sweepJobs();
  assert.equal((await replacement.listJobs()).assignment.status,'stopped');
  assert.equal((await replacement.listJobs()).pending,104);
});

test('a saved distribution retries rollback and counts commits from normal transfer once', async t => {
  let fail = false, accounted = false;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (fail && sql.includes('FROM outcomes o')) accounted = true;
    if (fail && accounted && sql === 'COMMIT') throw new Error('Synthetic transfer commit failure');
  } });
  await f.app.officeTopicReview.initialize();
  const newService = () => createUnknownTopicReview({db:f.app.db,topics:['Python'],transfer:options=>f.app.transferStagedPosts(options)});
  const first = newService();
  await first.initialize();
  for (const id of ['good','screened']) {
    await hold(f.pg,id,id === 'screened' ? 'ftp://example.invalid/unsupported' : undefined);
    await first.assign(id,{topic:'Python',expectedVersion:(await first.detail(id)).item.version,confirmed:true});
  }
  const input = {id:randomUUID(),confirmed:true};
  assert.equal((await first.startDistribution(input)).total,2);
  assert.equal((await first.startDistribution(input)).id,input.id);
  await hold(f.pg,'later');
  await first.assign('later',{topic:'Python',expectedVersion:(await first.detail('later')).item.version,confirmed:true});
  // A transaction that starts before confirmation can commit a backdated receipt afterward.
  await f.pg.query(`UPDATE office_unknown_topic_manual_assignments SET assigned_at='2026-01-01' WHERE post_id='later'`);
  fail = true;
  await first.sweepJobs();
  assert.equal(accounted,true);
  assert.equal((await first.listJobs()).distribution.remaining,2);
  assert.deepEqual((await first.listJobs()).distribution.progress,{});
  fail = false;
  const replacement = newService();
  await replacement.initialize();
  await f.app.transferStagedPosts({reason:'scheduled'});
  await f.pg.query('UPDATE office_held_post_jobs SET next_run_at=NOW() WHERE id=$1',[input.id]);
  await replacement.sweepJobs();
  await replacement.sweepJobs();
  const { distribution, pending } = await replacement.listJobs();
  assert.equal(distribution.status,'complete');
  assert.equal(distribution.remaining,0);
  assert.deepEqual(distribution.progress,{drained:2,transferred:1,screenedOut:1,heldForReview:0,preserved:0,conflicts:0,missing:0,failed:0});
  assert.equal(pending,0);
  assert.deepEqual((await f.pg.query("SELECT id FROM feed_posts_cache ORDER BY id")).rows.map(row=>row.id),['good','later']);
});

test('fixed job membership records missing staging and preserves the original for reconciliation', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true });
  const service = f.app.officeTopicReview;
  await service.initialize();
  for (const id of ['lost-stage','legacy-processed']) {
    await hold(f.pg,id);
    await service.assign(id,{topic:'Python',expectedVersion:(await service.detail(id)).item.version,confirmed:true});
  }
  const job = await service.startDistribution({id:randomUUID(),confirmed:true});
  await f.pg.query("DELETE FROM feed_posts_staging");
  await f.pg.query("UPDATE office_unknown_topic_manual_assignments SET processed_at=NOW() WHERE post_id='legacy-processed'");
  await service.sweepJobs();
  const { pending, missingStaging, distribution } = await service.listJobs();
  assert.equal(pending,0);
  assert.equal(missingStaging,2);
  assert.equal(distribution.status,'complete');
  assert.equal(distribution.total,job.total);
  assert.equal(distribution.remaining,0);
  assert.equal(distribution.progress.missing,2);
  assert.equal(distribution.progress.transferred,0);
  const { rows } = await f.pg.query(`SELECT post_id,outcome,outcome_reason,original_post->>'title' AS title
    FROM office_unknown_topic_manual_assignments ORDER BY post_id`);
  assert.deepEqual(rows,[
    {post_id:'legacy-processed',outcome:'missing',outcome_reason:'outcome_unavailable',title:'Python automation'},
    {post_id:'lost-stage',outcome:'missing',outcome_reason:'staging_copy_missing',title:'Python automation'},
  ]);
});

test('a permanent row failure preserves that post for review and lets healthy job items proceed', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async (sql, params) => {
    if (sql.includes('INSERT INTO feed_posts_cache AS existing') && JSON.parse(params[0]).some(post => post.id === 'broken')) {
      throw Object.assign(new Error('Synthetic row storage error'), {code:'23514'});
    }
  } });
  const service = f.app.officeTopicReview;
  await service.initialize();
  for (const id of ['broken','healthy']) {
    await hold(f.pg,id);
    await service.assign(id,{topic:'Python',expectedVersion:(await service.detail(id)).item.version,confirmed:true});
  }
  await service.startDistribution({id:randomUUID(),confirmed:true});
  await service.sweepJobs();
  const { distribution } = await service.listJobs();
  assert.equal(distribution.status,'complete');
  assert.equal(distribution.progress.failed,1);
  assert.equal(distribution.progress.transferred,1);
  assert.equal(distribution.progress.drained,2);
  assert.equal((await service.detail('broken')).item.reason,'reviewed-transfer-failed');
  assert.equal((await f.guardian.run({maxBatches:1})).restored,0);
  assert.deepEqual((await f.pg.query('SELECT id FROM feed_posts_cache')).rows,[{id:'healthy'}]);
});
