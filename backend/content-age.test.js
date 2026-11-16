'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ageInYears, validateBirthDate, youtubeMinimumViewerAge, blueskyMinimumViewerAge } = require('./content-age');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');
const { PGlite } = require('@electric-sql/pglite');

test('age uses calendar dates and signup eligibility follows the account region', () => {
  const now = new Date('2026-11-15T23:59:59.000Z');
  assert.equal(ageInYears('2008-11-15', now), 18);
  assert.equal(ageInYears('2008-11-16', now), 17);
  for (const invalid of [null, '2011-02-29', '2026-11-16', '26-11-15', '2001-1-01']) {
    assert.equal(ageInYears(invalid, now), null);
  }
  assert.equal(ageInYears('2008-02-29', new Date('2026-02-28T23:59:59Z')), 17);
  assert.equal(ageInYears('2008-02-29', new Date('2026-03-01T00:00:00Z')), 18);
  assert.equal(validateBirthDate('2013-11-15', 'US', now), null);
  assert.match(validateBirthDate('2013-11-16', 'US', now), /minimum age/);
  assert.match(validateBirthDate('2011-11-15', 'FR', now), /minimum age/);
  assert.match(validateBirthDate('2011-11-15', undefined, now), /minimum age/);
});

test('YouTube age restrictions and Bluesky adult labels survive normalization', () => {
  assert.equal(youtubeMinimumViewerAge({ contentRating: { ytRating: 'ytAgeRestricted' } }), 18);
  assert.equal(youtubeMinimumViewerAge({ duration: 'PT1M' }), 0);
  assert.equal(youtubeMinimumViewerAge(undefined), null);
  assert.equal(blueskyMinimumViewerAge({ labels: [{ val: 'sexual' }] }), 18);
  assert.equal(blueskyMinimumViewerAge({ author: { labels: [{ val: 'graphic-media' }] } }), 18);
  assert.equal(blueskyMinimumViewerAge({ record: { labels: { values: [{ val: 'porn' }] } } }), 18);
  assert.equal(blueskyMinimumViewerAge({ labels: [{ val: 'sexual', neg: true }, { val: 'spoiler' }] }), null);
});

test('only eligible sessions can retrieve a restricted video, including through a cached or direct copy', async t => {
  const { pg, app } = await createFeedRoutingFixture(t);
  const today = new Date().toISOString().slice(5, 10);
  const year = new Date().getUTCFullYear();
  app.seedUser(member('viewer-just-adult', { birthDate: `${year - 18}-${today}` }));
  app.seedUser(member('viewer-minor', { birthDate: `${year - 17}-${today}` }));
  app.seedUser(member('viewer-unknown'));
  const post = {
    id: 'youtube_abcdefghijk', source: 'youtube', title: 'Original title',
    content: 'The original caption', sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk',
    mediaUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    mediaPoster: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    embedId: 'abcdefghijk', mediaType: 'video', createdAt: new Date().toISOString(),
    topic: 'Python', minimumViewerAge: 18, videoDurationSeconds: 45, isExternal: true,
  };
  assert.equal(await app.savePostsToDB([post], 'feed_posts_staging'), 1);
  await app.transferStagedPosts({ maxBatches: 1, reason: 'age-gate-test' });
  assert.equal((await pg.query('SELECT minimum_viewer_age FROM feed_posts_cache WHERE id=$1', [post.id])).rows[0]?.minimum_viewer_age, 18);
  const stale = { ...post, minimumViewerAge: 0 };
  await app.savePostsToDBFast([stale], 'feed_posts_cache', app.db, { skipTrim: true });
  app.globalFeedCache.posts = [stale];
  await pg.exec(`INSERT INTO feed_posts_archive (${app.ARCHIVE_COLUMNS}) SELECT ${app.ARCHIVE_COLUMNS} FROM feed_posts_cache`);
  assert.equal((await pg.query('SELECT minimum_viewer_age FROM feed_posts_archive WHERE id=$1', [post.id])).rows[0].minimum_viewer_age, 18);
  const path = '/feed/' + post.id;
  for (const viewer of [null, 'viewer-minor', 'viewer-unknown']) {
    assert.equal((await app.request(path, { userId: viewer })).status, 404);
  }
  const adult = await app.request(path, { userId: 'viewer-just-adult' });
  assert.equal(adult.status, 200, JSON.stringify(adult.data));
  assert.match(adult.headers.get('cache-control'), /no-store/);
  assert.equal(adult.data.post.sourcePlaybackOnly, true);
  assert.equal(adult.data.post.sourceUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.doesNotMatch(JSON.stringify(adult.data), /ytimg|embedId|Original title|original caption/);
  assert.equal(await app.request(`${path}/comments`).then(result => result.status), 404);
  const save = await app.request('/saved/posts', { userId: 'viewer-minor', method: 'POST', body: { post: stale } });
  assert.equal(save.status, 404);

  const generalVideo = {
    ...post, id: 'youtube_lmnopqrstuv', title: 'Python video lesson', content: 'Learn Python.',
    sourceUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv',
    mediaUrl: 'https://i.ytimg.com/vi/lmnopqrstuv/hqdefault.jpg', mediaPoster: null, embedId: 'lmnopqrstuv',
    createdAt: new Date(Date.parse(post.createdAt) - 60_000).toISOString(), minimumViewerAge: 0,
  };
  assert.equal(await app.savePostsToDBFast([generalVideo], 'feed_posts_cache', app.db, { skipTrim: true }), 1);
  await pg.exec('ALTER TABLE seen_posts ADD COLUMN user_id TEXT, ADD COLUMN engaged_at TIMESTAMPTZ');
  const feedPath = '/office/feed/videos?sort=newest&source=youtube&topic=Python&limit=1';
  const minorFeed = await app.request(feedPath, { userId: 'viewer-minor' });
  assert.equal(minorFeed.status, 200, JSON.stringify(minorFeed.data));
  assert.deepEqual(minorFeed.data.posts.map(video => video.id), [generalVideo.id], app.errors.join('\n'));
  const adultFeed = await app.request(feedPath, { userId: 'viewer-just-adult' });
  assert.equal(adultFeed.status, 200, JSON.stringify(adultFeed.data));
  assert.deepEqual(adultFeed.data.posts.map(video => video.id), [post.id]);
  assert.equal(adultFeed.data.posts[0].sourcePlaybackOnly, true);
});

test('signup and first-time age capture persist one private birth date per account', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, email TEXT UNIQUE, phone TEXT,
    password_hash TEXT, title TEXT, account_type TEXT, organization TEXT, business_industry_id TEXT,
    onboarding_complete BOOLEAN DEFAULT false, birth_date TEXT);
    CREATE TABLE auth_sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), expires_at TIMESTAMPTZ);`);
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (sql.includes('business_team_members') || sql.includes('office_member') || sql.includes('site_activity_heartbeat')) return { rows: [] };
    return pg.query(sql, params.map(value => typeof value?.toISOString === 'function' ? value.toISOString() : value));
  } });
  t.after(() => app.close());
  const signup = { name: 'Local fixture', email: 'fixture@example.invalid', password: 'fixture-only-pass' };
  const register = body => app.request('/auth/register', { method: 'POST', body });
  assert.equal((await register(signup)).status, 400);
  assert.equal((await register({ ...signup, birthDate: new Date().toISOString().slice(0, 10) })).status, 400);
  const registered = await register({ ...signup, birthDate: '1995-04-12' });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  assert.equal(registered.data.profile.birthDateOnFile, true);
  assert.doesNotMatch(JSON.stringify(registered.data), /1995-04-12/);
  const headers = { authorization: 'Bearer ' + registered.data.token };
  const addBirthDate = birthDate => app.request('/profile/birth-date', { method: 'POST', headers, body: { birthDate } });
  assert.equal((await addBirthDate('1982-03-09')).status, 409);
  await pg.query('UPDATE users SET birth_date=NULL WHERE id=$1', [registered.data.profile.id]);
  assert.equal((await app.request('/profile/onboarding', { method: 'POST', headers, body: { interests: ['Python'] } })).status, 400);
  const saved = await addBirthDate('1995-04-12');
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data, { birthDateOnFile: true });
  assert.equal((await addBirthDate('1995-04-12')).status, 200);
  assert.equal((await pg.query('SELECT birth_date FROM users')).rows[0].birth_date, '1995-04-12');
});
