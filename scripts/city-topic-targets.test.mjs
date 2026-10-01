import test from 'node:test';
import assert from 'node:assert/strict';
import { fitsTopicTargets, topicCount } from '../web/src/local/cityTopicTargets.mjs';
const post = (id, source, topics) => ({ id, source, category: 'technology', topics });
test('house limits apply independently and a post matching multiple topics respects both limits', () => {
  const selections = { 'technology:github': ['Open Source', 'Web Development'], 'technology:reddit': ['Open Source'] };
  const targets = { 'technology:github': { 'Open Source': 1, 'Web Development': 4 }, 'technology:reddit': { 'Open Source': 2 } };
  const saved = [post('1', 'github', ['Open Source'])];
  assert.equal(fitsTopicTargets(post('2','github',['Open Source','Web Development']), saved, 'technology', selections, targets), false);
  assert.equal(fitsTopicTargets(post('3','reddit',['Open Source']), saved, 'technology', selections, targets), true);
  assert.equal(fitsTopicTargets(post('4','github',['Web Development']), saved, 'technology', selections, targets), true);
  assert.equal(topicCount(saved, 'Open Source', 'technology', 'reddit'), 0);
});
test('a city topic cap covers matching posts across sources', () => {
  const selected = [post('1','github',['Open Source']),post('2','reddit',['Open Source'])];
  assert.equal(fitsTopicTargets(post('3','gitlab',['Open Source']), selected, 'technology', { 'technology:city': ['Open Source'] }, { 'technology:city': { 'Open Source': 2 } }), false);
});
