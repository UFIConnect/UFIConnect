'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTopic, classifySubtopic } = require('./office-topic-transfer');

test('topic-specific subjects take precedence over generic tutorial or release formats', () => {
  assert.equal(classifySubtopic({ title: 'Django tutorial for beginners' }, 'Python'), 'Web frameworks');
  assert.equal(classifySubtopic({ title: 'Tutorial: how to get started', content: 'Build a Django application with this step by step guide and template.' }, 'Python'), 'Web frameworks');
  assert.equal(classifySubtopic({ title: 'PostgreSQL release announced' }, 'Database'), 'SQL');
  assert.equal(classifySubtopic({ title: 'New album release announced' }, 'Music Discovery'), 'New releases');
  assert.equal(classifySubtopic({ title: 'React component tutorial with a template' }, 'React'), 'Components');
});

test('title evidence outweighs incidental body terms and repetition adds no votes', () => {
  assert.equal(classifySubtopic({ title: 'Django application architecture', content: 'Compare this with pandas and numpy integrations.' }, 'Python'), 'Web frameworks');
  assert.equal(classifySubtopic({ title: 'Pandas data processing', content: 'Django '.repeat(40) }, 'Python'), 'Data & automation');
  assert.equal(classifySubtopic({ title: 'Release announced', content: 'A tutorial explains this update.' }, 'TypeScript'), 'News & releases');
});

test('equally supported specific siblings remain unclassified despite a generic match', () => {
  assert.equal(classifySubtopic({ title: 'Django and pandas tutorial' }, 'Python'), null);
  assert.equal(classifySubtopic({ title: 'A tutorial', content: 'Django and pandas are discussed equally.' }, 'Python'), null);
  assert.equal(classifySubtopic({ title: 'PostgreSQL and MongoDB benchmark' }, 'Database'), null);
  assert.equal(classifySubtopic({ title: 'Tutorial announcement' }, 'TypeScript'), null);
});

test('subtopics stay inside their parent taxonomy and only bounded whole terms match', () => {
  assert.equal(classifySubtopic({ title: 'Django tutorial' }, 'React'), 'Tutorials & guides');
  assert.equal(classifySubtopic({ title: 'Djangonauts gathering, no technical context' }, 'Python'), null);
  assert.equal(classifySubtopic({ title: 'Ordinary daily update' }, 'Python'), null);
  assert.equal(classifySubtopic({ title: 'DJANGO application', content: 'A short note.' }, 'Python'), 'Web frameworks');
  assert.equal(classifySubtopic({ title: 'Ordinary update', content: 'x'.repeat(16000) + ' Django' }, 'Python'), null);
});

test('unknown parent inference uses the same specific classifier without mutating inputs', () => {
  const post = { title: 'Python Django tutorial', content: 'A beginner guide to a web application.', topic: null };
  const before = { ...post };
  const result = classifyTopic(post, ['Python', 'JavaScript']);
  assert.equal(result.topic, 'Python'); assert.equal(result.subtopic, 'Web frameworks');
  assert.deepEqual(post, before);
});
