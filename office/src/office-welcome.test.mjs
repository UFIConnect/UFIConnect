import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeWelcome } from './office-welcome.mjs';

test('login announcement reports observations and latest Work state', () => {
  const value = officeWelcome({ services: [
    { role: 'api', data: { server: { serviceRole: 'api', db: 'connected' }, feed: { postCount: 1234 } } },
    { role: 'pipeline', data: { server: { serviceRole: 'pipeline', db: 'fallback' }, sources: { degraded: 3, paused: 2 } } },
  ], tasks: [{ status: 'completed', updatedAt: '2026-11-03T10:00:00Z' }, { status: 'needs_confirmation', updatedAt: '2026-11-04T10:00:00Z', message: 'secret material never spoken' }] });
  assert.equal(value.observed, true);
  assert.match(value.text, /1,234 posts/);
  assert.match(value.text, /3 sources are degraded and 2 are paused/);
  assert.match(value.text, /Pipeline database connection is not confirmed/);
  assert.match(value.text, /waiting for your approval/);
  assert.ok(!value.text.includes('secret material'));
  assert.ok(value.text.endsWith('Do you need anything?'));
});
test('wrong roles and failed reads never become healthy announcements', () => {
  const value = officeWelcome({ services: [{ role: 'pipeline', data: { server: { serviceRole: 'api', db: 'connected' } } }] });
  assert.equal(value.observed, false);
  assert.match(value.text, /Pipeline status could not be verified/);
  assert.ok(!value.text.includes('is connected'));
});
test('missing counts and unknown task states are never invented', () => {
  const value = officeWelcome({ services: [{ role: 'api', data: { server: { serviceRole: 'api' }, feed: { postCount: -1 } } }], tasks: [{ status: 'malicious words', updatedAt: '2026-11-04T10:00:00Z' }] });
  assert.ok(!value.text.includes('posts'));
  assert.ok(!value.text.includes('malicious'));
});
