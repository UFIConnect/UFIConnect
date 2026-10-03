import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBusinessRouteAllowed } from './businessRoutes.mjs';

test('Business membership keeps work, billing and account routes available', () => {
  for (const path of ['/recruiting', '/people', '/connected-accounts', '/messages', '/messages/candidate-123', '/settings', '/privacy', '/terms', '/login']) {
    assert.equal(isBusinessRouteAllowed(path), true, path);
  }
});

test('Business direct links cannot open personal feeds, entertainment or social tools', () => {
  for (const path of ['/', '/global', '/videos', '/music', '/groups', '/groups/group-1', '/p/social-post', '/profile', '/search', '/saved/posts', '/maps', '/command-center', '/you', '/vault', '/opportunities']) {
    assert.equal(isBusinessRouteAllowed(path), false, path);
  }
});
