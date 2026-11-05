import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingFormatGroups, sharedPublishingTitle } from './publishingFormats.mjs';
test('matching formats share a template while different provider operations retain meaningful groups', () => {
  const accounts = Object.fromEntries([['devto', 'article'], ['wordpress', 'article'], ['github', 'release'], ['gitlab', 'release'], ['youtube', 'video-upload']].map(([source, publishType]) => [source, { crossPost: { publishType } }]));
  assert.deepEqual(publishingFormatGroups(Object.keys(accounts), accounts).map(group => [group.id, group.sources]), [['article', ['devto', 'wordpress']], ['release', ['github', 'gitlab']], ['video', ['youtube']]]);
});
test('only actual compatible title fields share the strictest limit; provider consent fields never merge', () => {
  const fields = [{ key: 'title', type: 'text', maxLength: 200 }, { key: 'privacyStatus', type: 'select' }, { key: 'consent', type: 'checkbox' }];
  const title = sharedPublishingTitle({ label: 'Article', sources: ['devto', 'wordpress', 'other'] }, { devto: { fields }, wordpress: { fields: [{ ...fields[0], maxLength: 100 }] }, other: { fields: fields.slice(1) } });
  assert.deepEqual(title, { key: 'title', label: 'Article title', sources: ['devto', 'wordpress'], maxLength: 100 });
  assert.equal(sharedPublishingTitle({ label: 'Video', sources: ['youtube'] }, { youtube: { fields } }), null);
});
