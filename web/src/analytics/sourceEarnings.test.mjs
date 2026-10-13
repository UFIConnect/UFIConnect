import test from 'node:test';
import assert from 'node:assert/strict';
import { addEarningsEntry, earningsCsv, generateEarningsReport, providerEarningsRecords, validateEarningsEntry } from './sourceEarnings.mjs';

const date = new Date('2026-10-13T12:00:00Z');
const fields = { source: 'youtube', creatorAccount: 'https://www.youtube.com/channel/creator', amount: '0.1', currency: 'USD',
  startDate: '2026-09-01', endDate: '2026-09-30', reference: 'September statement' };
const input = patch => validateEarningsEntry({ ...fields, ...patch }, ['youtube', 'bluesky', 'mastodon'], '2026-10-13');
const youtube = { id: 'youtube', label: 'YouTube', connected: true, status: 'available', originalUrl: fields.creatorAccount, lastSyncedAt: date.toISOString(),
  revenue: { amount: 12.3456, currency: 'USD', status: 'estimated', startDate: fields.startDate, endDate: fields.endDate } };

test('real authorized provider estimates preserve provenance and missing sources are not zero', () => {
  const report = generateEarningsReport([youtube, { id: 'bluesky', connected: true, status: 'not_supported' }], [], date);
  assert.equal(report.records[0].amount, '12.3456');
  assert.equal(report.records[0].creatorAccount, fields.creatorAccount);
  assert.equal(report.records[0].provenance, 'provider_estimate');
  assert.deepEqual(report.sourceStatus[1], { source: 'bluesky', status: 'not_reported' });
  assert.equal(report.ufiPayments.available, null);
  assert.equal(report.records[0].paymentStatus, 'not_a_payout');
});
test('disconnected, stale, denied and malformed provider reports never become available revenue', () => {
  for (const patch of [{ connected: false }, { status: 'stale' }, { status: 'requires_permission' }, { revenue: { ...youtube.revenue, amount: null } },
    { revenue: { ...youtube.revenue, amount: NaN } }, { revenue: { ...youtube.revenue, startDate: null } }, { originalUrl: 'javascript:alert(1)' }]) {
    assert.deepEqual(providerEarningsRecords([{ ...youtube, ...patch }]), []);
  }
  assert.equal(providerEarningsRecords([{ ...youtube, revenue: { ...youtube.revenue, amount: 0 } }])[0].amount, '0');
});
test('decimal accounting preserves precision; currencies, creators, providers and verification remain separate', () => {
  const rows = [input({}), input({ amount: '0.2', startDate: '2026-10-01', endDate: '2026-10-10' }),
    input({ currency: 'EUR', amount: '10' }), input({ creatorAccount: 'https://www.youtube.com/channel/another', amount: '1' }),
    input({ source: 'mastodon', creatorAccount: 'https://mastodon.social/@creator', amount: '4' })];
  const report = generateEarningsReport([{ id: 'youtube' }, { id: 'mastodon' }], rows, date);
  assert.equal(report.totals.length, 4);
  assert.equal(report.totals[0].amount, '0.3');
  assert.ok(report.records.every(row => row.provenance === 'manual_unverified'));
});
test('overlapping statements cannot double count provider reports or other manual periods', () => {
  assert.throws(() => addEarningsEntry([input({})], input({ startDate: '2026-09-20', endDate: '2026-10-01' })), /overlapping/);
  const report = generateEarningsReport([youtube], [input({}), input({ reference: 'Duplicate with changed name' })], date);
  assert.equal(report.records.length, 1);
  assert.equal(report.excluded.length, 2);
  assert.equal(report.totals[0].amount, '12.3456');
});
test('statement input rejects nonfinite, negative, ambiguous amounts, impossible dates and unsafe accounts', () => {
  for (const patch of [{ amount: '-1' }, { amount: '1e5' }, { amount: '1,000' }, { amount: 'NaN' }, { amount: '' }, { amount: '0.1234567' },
    { currency: 'ZZZ' }, { source: 'unknown' }, { startDate: '2026-02-30' }, { endDate: '2026-01-01' }, { endDate: '2026-10-14' },
    { creatorAccount: 'https://a:b@example.com/account' }, { creatorAccount: 'http://example.com' }, { creatorAccount: 'https://127.0.0.1' }, { reference: '' }]) {
    assert.throws(() => input(patch), undefined, JSON.stringify(patch));
  }
});
test('exports carry attribution and guard spreadsheet formula references', () => {
  const report = generateEarningsReport([{ id: 'youtube' }], [input({ reference: '=HYPERLINK("https://evil.example")' })], date);
  const csv = earningsCsv(report);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://evil.example"")"'));
  assert.ok(csv.includes('manual_unverified'));
  const json = JSON.parse(JSON.stringify(report));
  assert.equal(json.records[0].source, 'youtube');
  assert.equal(json.records[0].scope, 'creator_account');
  assert.equal(json.ufiPayments.status, 'not_configured');
  assert.ok(!Object.hasOwn(json.records[0], 'watchTime'));
});
