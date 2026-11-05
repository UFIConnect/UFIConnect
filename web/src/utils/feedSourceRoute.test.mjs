import assert from 'node:assert/strict';
import test from 'node:test';
import { feedRouteSources } from './feedSourceRoute.mjs';

test('source directory links select their exact supported source', () => {
  assert.deepEqual(feedRouteSources('?feed=feed&source=github', 'feed'), ['github']);
  assert.deepEqual(feedRouteSources('?feed=following&source=youtube', 'following'), ['youtube']);
});

test('route source selections validate, deduplicate and preserve their order', () => {
  assert.deepEqual(feedRouteSources('?source=github&sources=youtube,github,unsupported&source=bluesky', 'feed'), ['github', 'bluesky', 'youtube']);
  assert.equal(feedRouteSources('?source=javascript%3Aalert(1)', 'feed'), null);
  assert.equal(feedRouteSources('?source=unsupported', 'following'), null);
  assert.equal(feedRouteSources('?feed=feed', 'feed'), null);
});

test('Home reset and location or group feeds cannot inherit source route filters', () => {
  assert.equal(feedRouteSources('?feed=feed&all=1&source=github', 'feed'), null);
  for (const mode of ['ufi', 'countries', 'restaurants', 'bars', 'groups']) {
    assert.equal(feedRouteSources('?source=github', mode), null);
  }
});
