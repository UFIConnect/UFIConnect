import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingDestinationChanged, publishingOptionDefaults, publishingOptionsReason } from './publishingOptionValidation.mjs';

const release = { destinationLabel: 'Repository', destinations: [{ id: 'org/repo', label: 'Repository' }], fields: [{ key: 'title', label: 'Release title', type: 'text', required: true, maxLength: 30 }, { key: 'tagName', label: 'Existing tag', type: 'select', required: true, options: [{ value: 'v1', label: 'v1' }] }] };

test('publishing requires deliberate destination and valid provider fields', () => {
  assert.match(publishingOptionsReason(release), /Repository/);
  assert.match(publishingOptionsReason(release, { destinationId: 'unknown' }), /available destination/);
  assert.match(publishingOptionsReason(release, { destinationId: 'org/repo' }), /Release title/);
  assert.match(publishingOptionsReason(release, { destinationId: 'org/repo', title: 'New release' }), /Existing tag/);
  assert.equal(publishingOptionsReason(release, { destinationId: 'org/repo', title: 'New release', tagName: 'v1' }), '');
  assert.match(publishingOptionsReason(release, { destinationId: 'org/repo', title: 'x'.repeat(31), tagName: 'v1' }), /Shorten/);
  assert.match(publishingOptionsReason({ ...release, destinations: [] }, {}), /Repository/);
});

test('changing repositories invalidates the old tag and refreshed choices cannot restore it', () => {
  const next = publishingDestinationChanged({ destinationId: 'org/repo', tagName: 'v1', title: 'Release' }, 'org/other');
  assert.deepEqual(next, { destinationId: 'org/other', tagName: '', title: 'Release' });
  assert.equal(publishingOptionDefaults(release, { ...next, tagName: 'deleted' }).tagName, '');
  assert.equal(publishingOptionDefaults(release, { ...next, tagName: 'v1' }).tagName, 'v1');
});

test('visibility and audience never inherit defaults and required checkboxes need consent', () => {
  const schema = { fields: [{ key: 'privacyStatus', label: 'Visibility', type: 'select', required: true, default: 'public', options: [{ value: 'public', label: 'Public' }] }, { key: 'consent', label: 'Consent', type: 'checkbox', required: true }, { key: 'notifySubscribers', type: 'checkbox', default: false }] };
  const values = publishingOptionDefaults(schema);
  assert.equal(values.privacyStatus, '');
  assert.equal(values.notifySubscribers, false);
  assert.match(publishingOptionsReason(schema, { privacyStatus: 'public', consent: false }), /Consent/);
  assert.equal(publishingOptionsReason(schema, { privacyStatus: 'public', consent: true }), '');
});

test('custom file URLs work without selecting a listed file', () => {
  const schema = { allowCustomDestination: true, destinationLabel: 'Figma file URL or key', destinations: [] };
  assert.match(publishingOptionsReason(schema), /Figma/);
  assert.equal(publishingOptionsReason(schema, { destinationId: 'https://www.figma.com/design/abc/File' }), '');
});

test('only current verified destination recommendations fill a blank choice', () => {
  assert.equal(publishingOptionDefaults(release).destinationId, 'org/repo');
  const schema = { ...release, destinations: [{ id: 'org/one' }, { id: 'org/two' }], suggestedValues: { destinationId: 'org/two', privacyStatus: 'public', madeForKids: 'yes' } };
  assert.equal(publishingOptionDefaults(schema).destinationId, 'org/two');
  assert.equal(publishingOptionDefaults(schema, { destinationId: 'org/one' }).destinationId, 'org/one', 'Never replace a current user choice');
  assert.equal(publishingOptionDefaults(schema, { destinationId: '' }).destinationId, '', 'An explicit blank must survive refresh');
  assert.equal(publishingOptionDefaults(schema, { destinationId: 'removed/repository' }).destinationId, '', 'A removed choice needs review');
  const invalid = { ...schema, suggestedValues: { destinationId: 'different/account' } };
  assert.equal(publishingOptionDefaults(invalid).destinationId, '');
  assert.equal(publishingOptionDefaults(schema).privacyStatus, undefined);
  assert.equal(publishingOptionDefaults(schema).madeForKids, undefined);
});
