const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_POLICY, listSourcePolicies, getSourcePolicy, getInteractionCapabilities, isSourceActionAllowed, isSourceDisplayAllowed, validateOriginalUrl } = require('./source-policy');

test('every source forbids extraction, synthetic metrics, scraping and rehosting', () => {
  const policies = listSourcePolicies({ env: {} });
  assert.equal(policies.length, 18);
  for (const policy of policies) {
    assert.equal(policy.originalLinkRequired, true);
    assert.equal(policy.attributionRequired, true);
    for (const feature of ['directRehosting', 'cacheVideo', 'scrapingFallback', 'mediaExtraction', 'syntheticMetrics']) {
      assert.equal(policy.capabilities[feature].status, 'dont_implement');
      assert.equal(policy.features[feature], false);
    }
    assert.ok(policy.documentation.every(url => url.startsWith('https://')));
    for (const rule of ['authentication', 'api', 'display', 'trademark', 'caching', 'deletion', 'interactions', 'analytics']) assert.ok(policy.rules[rule]);
    assert.equal(policy.rules.reporting.automaticProviderTakedown, false);
    assert.equal(policy.rules.analytics.syntheticMetricsAllowed, false);
    assert.ok(policy.rules.caching.metricSnapshotFreshnessMs <= policy.rules.caching.metricSnapshotRetentionMs);
  }
  assert.equal(Object.isFrozen(SOURCE_POLICY.youtube.capabilities.like), true);
  assert.equal(Object.isFrozen(SOURCE_POLICY.youtube.rules.caching), true);
  assert.notEqual(SOURCE_POLICY.bluesky.rules.authentication.requirement, SOURCE_POLICY.mastodon.rules.authentication.requirement);
});

test('runtime switches disable writes and cannot enable an unimplemented action', () => {
  assert.equal(isSourceActionAllowed('X', 'like', { env: {} }), true);
  for (const env of [{ SOURCE_ACCESS_ENABLED: 'false' }, { SOURCE_INTERACTIONS_ENABLED: '0' }, { SOURCE_TWITTER_ENABLED: 'off' }, { SOURCE_TWITTER_LIKE_ENABLED: 'false' }, { SOURCE_TWITTER_LIKE_ENABLED: 'misspelled' }]) {
    assert.equal(isSourceActionAllowed('twitter', 'like', { env }), false);
  }
  assert.equal(isSourceActionAllowed('tiktok', 'like', { env: { SOURCE_TIKTOK_LIKE_ENABLED: 'true' } }), false);
  assert.equal(isSourceActionAllowed('__proto__', 'like', { env: {} }), false);
  assert.equal(isSourceActionAllowed('youtube', 'view', { env: {} }), false);
  assert.equal(getSourcePolicy('unknown'), null);
});

test('YouTube creator collectors require permission and respect independent kill switches', () => {
  const policy = getSourcePolicy('youtube', { env: {} });
  assert.equal(policy.features.sourceAnalytics, true);
  assert.equal(policy.capabilities.sourceAnalytics.status, 'requires_approval');
  assert.equal(policy.features.creatorAnalytics, true);
  assert.equal(policy.features.sourceMonetization, true);
  assert.equal(getSourcePolicy('youtube', { env: { SOURCE_YOUTUBE_CREATOR_ANALYTICS_ENABLED: 'false' } }).features.creatorAnalytics, false);
  assert.equal(getSourcePolicy('youtube', { env: { SOURCE_YOUTUBE_SOURCE_MONETIZATION_ENABLED: 'false' } }).features.sourceMonetization, false);
  assert.equal(getSourcePolicy('tiktok', { env: { SOURCE_TIKTOK_CREATOR_ANALYTICS_ENABLED: 'true' } }).features.creatorAnalytics, false);
  assert.equal(getSourcePolicy('youtube', { env: { SOURCE_YOUTUBE_SOURCE_ANALYTICS_ENABLED: 'false' } }).features.sourceAnalytics, false);
});

test('source display revocation removes reviewed sources without suppressing native posts', () => {
  assert.equal(isSourceDisplayAllowed('youtube', { env: { SOURCE_YOUTUBE_ENABLED: 'false' } }), false);
  assert.equal(isSourceDisplayAllowed('youtube', { env: { SOURCE_YOUTUBE_DISPLAY_POST_ENABLED: 'false' } }), false);
  assert.equal(isSourceDisplayAllowed('youtube', { env: {} }), true);
  assert.equal(isSourceDisplayAllowed('uficonnect', { env: { SOURCE_ACCESS_ENABLED: 'false' } }), true);
});

test('capabilities reveal booleans and fallback labels without credentials', () => {
  const capabilities = getInteractionCapabilities({ socialTokens: { youtube: 'TOP-SECRET', tiktok: 'OTHER-SECRET' } }, { env: { SOURCE_YOUTUBE_LIKE_ENABLED: 'false' } });
  assert.equal(capabilities.youtube.connected, true);
  assert.equal(capabilities.youtube.like, false);
  assert.equal(capabilities.youtube.comment, true);
  assert.equal(capabilities.tiktok.connected, true);
  assert.equal(capabilities.tiktok.like, false);
  assert.equal(capabilities.youtube.fallback.like, 'Like on YouTube');
  assert.equal(JSON.stringify(capabilities).includes('SECRET'), false);
});

test('original source links reject host confusion, credentials, ports and unsupported schemes', () => {
  assert.equal(validateOriginalUrl('youtube', 'https://youtu.be/abcdefghijk'), 'https://youtu.be/abcdefghijk');
  for (const value of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com@evil.test/watch', 'https://user:pass@youtube.com/watch', 'https://youtube.com:443/watch', 'https://youtube.com./watch', 'http://youtube.com/watch', 'javascript:alert(1)', '//youtube.com/watch', 'https://youtube.com\\@evil.test/watch', 'https://you\ntube.com/watch']) assert.equal(validateOriginalUrl('youtube', value), null, value);
  assert.equal(validateOriginalUrl('github', 'https://gitlab.com/org/repo'), null);
  assert.equal(validateOriginalUrl('mastodon', 'https://community.example/@user/123', { env: {} }), 'https://community.example/@user/123');
  assert.equal(validateOriginalUrl('mastodon', 'https://community.example/@user/123', { env: { SOURCE_MASTODON_ORIGINS: 'https://community.example' } }), 'https://community.example/@user/123');
  for (const value of ['https://community.example/', 'https://community.example/@user', 'https://private.internal/@user/123', 'https://127.0.0.1/@user/123', 'https://community.example/@user/123/extra']) assert.equal(validateOriginalUrl('mastodon', value), null);
});

test('Mastodon capabilities require each granted interaction scope and retain policy switches', () => {
  const user = scope => ({ socialTokens: { mastodon: JSON.stringify({ scope }) } });
  const readOnly = getInteractionCapabilities(user('read:accounts read:statuses'), { env: {} }).mastodon;
  assert.equal(readOnly.connected, true);
  assert.equal(readOnly.like, false);
  assert.equal(readOnly.comment, false);
  assert.equal(readOnly.reconnectRequired, true);
  const likesOnly = getInteractionCapabilities(user('read:search write:favourites'), { env: {} }).mastodon;
  assert.equal(likesOnly.like, true);
  assert.equal(likesOnly.comment, false);
  const full = getInteractionCapabilities(user('read write'), { env: {} }).mastodon;
  assert.equal(full.like, true);
  assert.equal(full.comment, true);
  assert.equal(full.reconnectRequired, false);
  assert.equal(full.maxLength, 500);
  assert.equal(getInteractionCapabilities(user('read write'), { env: { SOURCE_MASTODON_COMMENT_ENABLED: 'false' } }).mastodon.comment, false);
});
