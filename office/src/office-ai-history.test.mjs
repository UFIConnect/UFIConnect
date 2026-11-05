import test from 'node:test';
import assert from 'node:assert/strict';
import { officeAIHistory } from './office-ai-history.mjs';

test('complete long messages fit without a per-message character cap', () => {
  const messages = [{ role: 'user', content: 'u'.repeat(16000) }, { role: 'assistant', content: 'a'.repeat(16000) }];
  assert.deepEqual(officeAIHistory(messages), messages);
});

test('long continuation retains the request and both ends of the answer', () => {
  const request = 'Explain and continue this deliverable.';
  const answer = `ANSWER START ${'x'.repeat(48000)} ANSWER END`;
  const messages = [{ role: 'user', content: 'Old exchange' }, { role: 'assistant', content: 'Old reply' },
    { role: 'user', content: request }, { role: 'assistant', content: answer }];
  const history = officeAIHistory(messages);
  assert.equal(history.length, 2);
  assert.equal(history[0].content, request);
  assert.ok(history[1].content.startsWith('ANSWER START '));
  assert.ok(history[1].content.endsWith(' ANSWER END'));
  assert.equal(history.reduce((sum, item) => sum + item.content.length, 0), 32000);
  assert.equal(messages[3].content, answer);
});

test('oversized question and answer share the context budget', () => {
  const history = officeAIHistory([{ role: 'user', content: 'u'.repeat(40000) }, { role: 'assistant', content: 'a'.repeat(50000) }]);
  assert.deepEqual(history.map(item => item.content.length), [16000, 16000]);
});

test('recent valid messages respect entry and total context limits', () => {
  const messages = [{ role: 'system', content: 'excluded' }, { role: 'user', content: '' },
    ...Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Message ${index}` }))];
  const history = officeAIHistory(messages);
  assert.equal(history.length, 12);
  assert.equal(history[0].content, 'Message 8');
  assert.equal(history.at(-1).content, 'Message 19');
  const single = officeAIHistory([{ role: 'assistant', content: 'a'.repeat(50000) }]);
  assert.equal(single[0].content.length, 32000);
});

test('task history uses its larger aggregate budget', () => {
  const history = officeAIHistory([{ role: 'user', content: 'u'.repeat(30000) }, { role: 'assistant', content: 'a'.repeat(30000) }],
    { maxMessages: 24, maxCharacters: 48000 });
  assert.deepEqual(history.map(item => item.content.length), [24000, 24000]);
});
