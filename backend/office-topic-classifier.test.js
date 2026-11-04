'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { classifyTopic, isUnknownTopic } = require('./office-topic-transfer');

// Exercise competing topics from the application catalog, not a one-topic
// fixture that would conceal collisions between neighboring subjects.
const source = readFileSync(join(__dirname, 'index.js'), 'utf8');
const catalog = source.match(/const FEED_TOPICS = \[([\s\S]*?)\n\];/)[1].replace(/\/\/[^\n]*/g, '');
const topics = [...catalog.matchAll(/'([^']+)'/g)].map(match => match[1]);

test('topic recovery recognizes subject evidence across the live catalog', () => {
  const examples = [
    ['Private object storage with tenant isolation', 'Cloud & DevOps'],
    ['Fix your targetSdk error in Play Console', 'Mobile Dev'],
    ['Time zones with Intl.DateTimeFormat', 'JavaScript'],
    ['Deploy services with K8s', 'Kubernetes'],
    ['Senior Backend Engineer', 'Backend Dev'],
    ['Nutrition and a balanced diet', 'Nutrition & Diet'],
    ['Football results from the weekend', 'Football & Soccer'],
    ['A new watercolor painting exhibition', 'Art & Painting'],
    ['Cat care and responsible pet adoption', 'Pet Ownership'],
    ['Fine dining: a restaurant review', 'Restaurant Culture'],
    ['Improve your espresso as a barista', 'Coffee Culture'],
    ['A screenplay for the screenwriting workshop', 'Screenwriting & Film'],
    ['A clinical medicine update on HIV diagnosis', 'Medicine & Clinical Practice'],
    ['Carbon dioxide pollution and greenhouse gas emissions', 'Environmental Science'],
    ['Recruitment and talent acquisition practices', 'Recruiting & Hiring'],
    ['Virtual reality and mixed reality devices', 'AR / VR'],
    ['Litigation and the latest case law', 'Law & Legal Practice'],
    ['Drone aircraft advances in aerospace', 'Aviation & Aerospace'],
  ];
  for (const [title, expected] of examples) assert.equal(classifyTopic({ title }, topics)?.topic, expected, title);
});

test('ties and evidence-free posts stay unresolved regardless of provider metadata', () => {
  assert.equal(classifyTopic({ title: 'Python and JavaScript' }, topics), null);
  assert.equal(classifyTopic({ title: 'Python and JavaScript', topic: 'Python' }, topics)?.topic, 'Python');
  assert.equal(classifyTopic({ title: 'Go outside, clean the rust, and react to this node.' }, topics), null);
  assert.equal(classifyTopic({ title: 'AAAAAAAAAA', source: 'mastodon' }, topics), null);
  assert.equal(classifyTopic({ title: 'Example / project', content: 'My awesome project', source: 'gitlab', sourceUrl: 'https://gitlab.com/example/project' }, topics), null);
  assert.equal(classifyTopic({ title: 'A thoughtful message', source: 'arxiv', tags: ['Python'] }, topics), null);
});

test('compiled patterns preserve unicode boundaries, bounded inputs, and nonmutation', () => {
  assert.equal(classifyTopic({ title: 'ＪＡＶＡＳＣＲＩＰＴ tools' }, topics)?.topic, 'JavaScript');
  assert.equal(classifyTopic({ title: 'microfootballer and pythonesque prose' }, topics), null);
  assert.equal(classifyTopic({ content: 'x'.repeat(16000) + ' Kubernetes' }, topics), null);
  const post = { title: 'Python Django tutorial', content: 'A guide', topic: null };
  const original = { ...post };
  for (let i = 0; i < 10; i++) assert.equal(classifyTopic(post, topics)?.subtopic, 'Web frameworks');
  assert.deepEqual(post, original);
});

test('catalog cache respects changed topics and ignores Unknown labels as evidence', () => {
  const mutable = ['Python'];
  assert.equal(classifyTopic({ title: 'Python tutorial' }, mutable)?.topic, 'Python');
  mutable[0] = 'JavaScript';
  assert.equal(classifyTopic({ title: 'Python tutorial' }, mutable), null);
  assert.equal(classifyTopic({ title: 'JavaScript tutorial' }, mutable)?.topic, 'JavaScript');
  assert.equal(classifyTopic({ title: 'Unknown general information' }, ['Unknown', 'general', '', 'Python']), null);
  for (const value of [null, undefined, '', ' UNKNOWN ', 'unclassified', ' Uncategorized ', 'general', 'none', 'null']) assert.equal(isUnknownTopic(value), true);
  assert.equal(isUnknownTopic('Python'), false);
});
