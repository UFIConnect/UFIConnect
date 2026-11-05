import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import { withCareerAccountFallback, HOME_FEED_SOURCE_IDS, JOB_FEED_SOURCE_IDS, JOB_WEBSITE_SOURCE_IDS, CAREER_ACCOUNT_PLATFORMS, FOLLOWING_FEED_SOURCE_IDS, isFollowingFeedSource, unavailableFeedSourceIds } from './sourceMeta.js';
import feedCatalog from '../../../shared/feed-source-catalog.json' with { type: 'json' };
import { normalizeSourceFavorites } from './sourceFavorites.js';

test('missing, partial and unavailable source authorization stays locked', () => {
  for (const platform of [undefined, {}, { configured: false }, { configured: 'true' },
    { configured: true, forceComingSoon: true }, { configured: true, authorizationAvailable: false },
    { configured: true, authorizationSupported: false }, { configured: true, connectionMode: 'external' },
    { configured: true, canStartAuthorization: false }]) {
    assert.equal(sourceAuthorizationState(platform).ready, false);
    assert.equal(sourceAuthorizationState(platform, { isConnected: true }).ready, false);
  }
});

test('removed interest and unsupported Following favorites do not remain selected', () => {
  assert.deepEqual(normalizeSourceFavorites({ feed: ['twitter', 'facebook', 'weworkremotely', 'hackernews'], following: ['twitter', 'facebook', 'spotify', 'hackernews', 'future-unsupported', 'youtube', 'youtube'] }), {
    feed: ['twitter', 'facebook', 'hackernews'], following: ['twitter', 'youtube'],
  });
});

test('configured account authorization stays available independently of membership feature locks', () => {
  assert.equal(sourceAuthorizationState({ configured: true, connectionMode: 'oauth', crossPost: { supported: false }, ownPosts: { supported: false } }).ready, true);
  assert.equal(sourceAuthorizationState({ configured: true, locked: true }).ready, true);
  assert.equal(sourceAuthorizationState({ configured: true, locked: true }, { isConnected: true }).ready, true);
  for (const connectionMode of ['oauth', 'api-key']) {
    assert.equal(sourceAuthorizationState({ configured: true, connectionMode, canStartAuthorization: true, locked: true }).ready, true);
    assert.equal(sourceAuthorizationState({ configured: true, connectionMode, canStartAuthorization: false, locked: true }).ready, false);
    assert.equal(sourceAuthorizationState({ configured: true, connectionMode, authorizationAvailable: false, locked: true }).ready, false);
  }
});

test('directory fallback cannot replace explicit catalog readiness or permissions', () => {
  const platforms = withCareerAccountFallback({
    indeed: { name: 'Indeed', category: 'career', configured: false, forceComingSoon: true, connectionMode: 'oauth', locked: true },
    youtube: { name: 'YouTube', configured: true, analytics: { authorized: true } },
    spotify: { name: 'Spotify', configured: true, connectionMode: 'external' },
  });
  assert.equal(platforms.indeed.configured, false);
  assert.equal(platforms.indeed.forceComingSoon, true);
  assert.equal(platforms.indeed.locked, true);
  assert.equal(platforms.indeed.connectionMode, 'oauth');
  assert.equal(sourceAuthorizationState(platforms.indeed).ready, false);
  assert.equal(sourceAuthorizationState(platforms.youtube).ready, true);
  assert.deepEqual(platforms.youtube.analytics, { authorized: true });
  assert.equal(sourceAuthorizationState(platforms.spotify).ready, false);
  const career = withCareerAccountFallback({}, true);
  assert.equal(sourceAuthorizationState(career.indeed).ready, false);
  assert.equal(career.indeed.connectionMode, 'external');
});

test('feed choices use real public collectors and followed-content adapters', () => {
  assert.deepEqual(HOME_FEED_SOURCE_IDS, [...new Set(feedCatalog.home)]);
  for (const key of ['cntraveler', 'hackernews']) assert.ok(HOME_FEED_SOURCE_IDS.includes(key));
  assert.deepEqual(JOB_FEED_SOURCE_IDS, ['indeed', 'remoteok', 'remotive', 'muse', 'usajobs', 'weworkremotely']);
  for (const key of CAREER_ACCOUNT_PLATFORMS) {
    assert.equal(HOME_FEED_SOURCE_IDS.includes(key), false, `${key} belongs outside Home`);
    assert.ok(JOB_FEED_SOURCE_IDS.includes(key) || JOB_WEBSITE_SOURCE_IDS.includes(key), `${key} remains accessible in Jobs`);
  }
  for (const key of JOB_WEBSITE_SOURCE_IDS) assert.equal(JOB_FEED_SOURCE_IDS.includes(key), false);
  assert.deepEqual(FOLLOWING_FEED_SOURCE_IDS, ['uficonnect', ...Object.keys(feedCatalog.following)]);
  for (const key of ['youtube', 'github', 'gitlab', 'reddit', 'twitch', 'bluesky', 'mastodon', 'twitter']) assert.ok(FOLLOWING_FEED_SOURCE_IDS.includes(key));
  for (const key of ['spotify', 'airbnb', 'indeed', 'facebook', 'hackernews', 'discord', 'figma', 'linkedin', 'instagram', 'tiktok']) assert.equal(FOLLOWING_FEED_SOURCE_IDS.includes(key), false);
  for (const kind of Object.values(feedCatalog.following)) assert.equal(kind, 'following');
  for (const source of ['uficonnect', 'youtube', ' mastodon ', 'twitter']) assert.equal(isFollowingFeedSource(source), true);
  for (const source of [undefined, 'unknown-provider', 'spotify', 'cntraveler', 'facebook', 'hackernews', 'indeed']) assert.equal(isFollowingFeedSource(source), false);
});

test('new account and website sources remain visible as unavailable without entering feed or favorites allowlists', () => {
  const home = unavailableFeedSourceIds('feed');
  const following = unavailableFeedSourceIds('following');
  for (const key of ['instagram', 'tiktok', 'threads', 'linkedin', 'pinterest', 'tumblr', 'wordpress', 'reuters', 'bbc', 'spotify']) {
    assert.ok(home.includes(key), key);
    assert.ok(following.includes(key), key);
  }
  assert.ok(following.includes('weworkremotely'));
  assert.ok(following.includes('cntraveler'));
  assert.equal(home.includes('weworkremotely'), true);
  assert.equal(home.includes('cntraveler'), false);
  for (const source of home) assert.equal(HOME_FEED_SOURCE_IDS.includes(source), false);
  for (const source of following) assert.equal(FOLLOWING_FEED_SOURCE_IDS.includes(source), false);
  assert.equal(unavailableFeedSourceIds('following', { includeWebsites: false }).includes('reuters'), false);
  const business = unavailableFeedSourceIds('following', { careerOnly: true });
  assert.ok(business.includes('weworkremotely'));
  for (const source of ['instagram', 'airbnb', 'bbc']) assert.equal(business.includes(source), false);
  assert.deepEqual(normalizeSourceFavorites({ feed: home, following }), { feed: [], following: [] });
});
