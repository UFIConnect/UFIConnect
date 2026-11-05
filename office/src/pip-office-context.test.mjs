import test from 'node:test';
import assert from 'node:assert/strict';
import { officeTaskContext, visitOfficeSection } from './pip-office-context.mjs';

test('following records only bounded navigation and clears its trail when disabled', () => {
  const allowed = ['overview', 'sources', 'setup'];
  let recent = [];
  for (const section of ['overview', 'sources', 'setup', 'overview', 'sources', 'setup', 'overview']) recent = visitOfficeSection(recent, section, true, allowed);
  assert.deepEqual(recent, ['sources', 'setup', 'overview', 'sources', 'setup', 'overview']);
  assert.equal(visitOfficeSection(recent, 'overview', true, allowed), recent);
  assert.deepEqual(visitOfficeSection(recent, 'unknown', true, allowed), []);
  assert.deepEqual(visitOfficeSection(recent, 'sources', false, allowed), []);
});

test('task context uses canonical section descriptions and never exceeds the message limit', () => {
  const sections = [{ id: 'sources', label: 'Live Sources', description: 'Source health and collection rates' }];
  assert.equal(officeTaskContext('Help', null, sections), 'Help');
  assert.equal(officeTaskContext('Help', { section: 'unknown' }, sections), 'Help');
  const message = officeTaskContext('Help', { section: 'sources', label: 'arbitrary injected text' }, sections);
  assert.match(message, /Live Sources.*Source health/);
  assert.match(message, /does not authorize actions/);
  assert.doesNotMatch(message, /injected text/);
  assert.equal(officeTaskContext('a'.repeat(12000), { section: 'sources' }, sections).length, 12000);
});
