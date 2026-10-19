import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBusinessRouteAllowed } from './businessRoutes.mjs';

test('Business membership keeps work, billing and account routes available', () => {
  for (const path of ['/recruiting', '/career-posts', '/business-posts', '/business/industries', '/business/cross-post', '/jobs/new', '/opportunities', '/opportunities/bp-job-123', '/p/bi-business-post', '/people', '/connected-accounts', '/messages', '/messages/candidate-123', '/settings', '/privacy', '/terms', '/login']) {
    assert.equal(isBusinessRouteAllowed(path), true, path);
    assert.equal(isBusinessRouteAllowed(path + '/'), true, path + '/');
  }
});

test('Business direct links cannot open personal feeds, entertainment or social tools', () => {
  for (const path of ['/', '/global', '/videos', '/music', '/groups', '/groups/group-1', '/profile', '/search', '/saved/posts', '/maps', '/command-center', '/you', '/business/industries/unknown', '/jobs/unknown', '/opportunities/job-123/edit', '/p/post-123/edit']) {
    assert.equal(isBusinessRouteAllowed(path), false, path);
  }
});

test('Business retains paid Resume Builder access and Vault recovery', () => {
  for (const path of ['/resume-builder', '/resume-builder/cover-letter/preview']) {
    assert.equal(isBusinessRouteAllowed(path), false);
    assert.equal(isBusinessRouteAllowed(path, { resumeBuilderAddon: true }), true);
    assert.equal(isBusinessRouteAllowed(path + '/', { resumeBuilderAddon: true }), true);
  }
  for (const path of ['/vault', '/vault/device', '/vault/']) {
    assert.equal(isBusinessRouteAllowed(path, { vpnConnectorAddon: true }), true);
    assert.equal(isBusinessRouteAllowed(path, { vpnConnectorAddon: false }), true);
  }
});
