import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managedRecoveryState, feedRecoverySummary, feedProviderSummary } from '../office/src/recovery-status.mjs';
import { buildCityModel } from '../office/src/city-model.mjs';

const now = Date.parse('2026-09-22T12:00:00Z');
const recovery = { configured: true, status: 'available', checkedAt: new Date(now).toISOString(),
  primary: { state: 'available', recovery: { status: 'available', startsAt: '2026-09-20T12:00:00Z' } },
  feedReplica: { configured: true, state: 'suspended' }, issues: [] };

test('primary recovery can be available while the independent feed copy is suspended', () => {
  assert.equal(managedRecoveryState(recovery, now), 'available');
  assert.match(feedRecoverySummary({ enabled: true, connected: false }, recovery), /Suspended in Render/);
  const model = buildCityModel({ status: { server: { serviceRole: 'api', managedRecovery: recovery, dbBackupStatus: { enabled: true, connected: false } } },
    telemetry: { api: { updatedAt: now } }, now });
  assert.equal(model.byId.backup.label, 'Data recovery');
  assert.equal(model.byId.backup.health, 'degraded', 'The feed copy problem remains visible');
  assert.equal(model.byId.backup.metrics.find(metric => metric.label === 'Primary recovery').value, 'available');
  assert.ok(model.byId.backup.levels.some(level => level.title === 'Primary database recovery'));
});

test('stale, future-dated or failed managed recovery evidence never appears available', () => {
  assert.equal(managedRecoveryState(recovery, now + 90_001), 'stale');
  assert.equal(managedRecoveryState(recovery, now - 5_001), 'stale');
  assert.equal(managedRecoveryState({ ...recovery, issues: [{ component: 'recovery' }] }, now), 'unknown');
  assert.equal(managedRecoveryState({ ...recovery, checkedAt: null }, now), 'unknown');
  assert.equal(managedRecoveryState({ ...recovery, status: 'unknown' }, now), 'unknown');
  assert.equal(managedRecoveryState(null, now), 'unknown');
  const model = buildCityModel({ status: { server: { serviceRole: 'api', managedRecovery: recovery, dbBackupStatus: { enabled: true, connected: true, syncing: true } } },
    telemetry: { api: { updatedAt: now + 90_001 } }, now: now + 90_001 });
  assert.equal(model.byId.backup.health, 'unknown');
  assert.equal(model.byId.backup.active, false);
});

test('secondary provider errors keep primary PITR available and secondary evidence unverified', () => {
  for (const component of ['exports', 'feedReplica']) {
    const partial = { ...recovery, issues: [{ component, code: 'access_denied' }],
      feedReplica: { configured: true, state: component === 'feedReplica' ? 'unknown' : 'available' },
      primary: { ...recovery.primary, exportsChecked: component !== 'exports', latestExport: null } };
    assert.equal(managedRecoveryState(partial, now), 'available');
    if (component === 'feedReplica') assert.match(feedProviderSummary(partial), /unverified/);
    else assert.equal(partial.primary.exportsChecked, false);
    const model = buildCityModel({ status: { server: { serviceRole: 'api', managedRecovery: partial,
      dbBackupStatus: { enabled: true, connected: true, lastSyncAt: new Date(now).toISOString() } } },
      telemetry: { api: { updatedAt: now } }, now });
    assert.equal(model.byId.backup.health, 'unknown', 'Unverified secondary evidence must not imply all recovery paths are healthy');
    assert.equal(model.byId.backup.metrics.find(metric => metric.label === 'Primary recovery').value, 'available');
  }
});
