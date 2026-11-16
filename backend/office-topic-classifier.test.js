'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { assessPostTopic, classifyTopic, isUnknownTopic, resolvePostTopic, subtopicRules } = require('./office-topic-transfer');

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

test('validated community subjects and multilingual aliases share the feed taxonomy', () => {
  const examples = [
    [{ title: 'Images from the observatory #Astronomía' }, 'Science & Research', 'Astronomy', 'hashtag'],
    [{ title: 'Techniques de natation' }, 'Sports', 'Swimming', 'title'],
    [{ content: 'Guía de autoalojamiento.' }, 'Cloud & DevOps', 'Self-hosting', 'body'],
    [{ title: 'Updates #StableDiffusion' }, 'Generative AI', 'Image generation', 'hashtag'],
    [{ title: 'Trabajos de carpintería' }, 'Home Improvement', 'Woodworking', 'title'],
    [{ title: 'Sensores para plantas de interior' }, 'Gardening & Plants', 'Houseplants', 'title'],
  ];
  for (const [post, topic, subtopic, field] of examples) {
    const result = resolvePostTopic(post, topics);
    assert.equal(result?.topic, topic, JSON.stringify(post));
    assert.equal(result?.subtopic, subtopic);
    assert.equal(result?.evidenceSource, field);
    assert.ok(Object.hasOwn(subtopicRules(topic), subtopic));
  }
  const group = { subreddit: 'r/LocalLLaMA', category: 'AI & ML' };
  const result = resolvePostTopic({ title: 'Which setup works?' }, topics, { group });
  assert.equal(result?.subtopic, 'Local models');
  assert.equal(result?.evidenceSource, 'public-group');
  assert.equal(result?.confidence, 'medium');
  assert.equal(resolvePostTopic({ title: 'Which setup works?' }, topics, { group: { ...group, isPrivate: true } }), null);
  assert.equal(Object.keys(subtopicRules('Generative AI')).filter(name => name === 'Image generation').length, 1);
  assert.ok(subtopicRules('Generative AI')['Image generation'].includes('diffusion model'));
});

test('competing parents and subtopics stay open for review despite fallback hints and repeated aliases', () => {
  const group = { subreddit: 'r/formula1', category: 'Sports' };
  assert.deepEqual(assessPostTopic({ title: 'Python and JavaScript', topic: 'Amateur Formula 1 coverage' }, topics, { group }),
    { competing: ['JavaScript', 'Python'] });
  assert.equal(resolvePostTopic({ title: 'Notes from yesterday', content: 'https://example.test/Python #misc', source: 'reddit' }, topics,
    { group: { name: 'An unverified label', category: 'Engineering' } }), null);
  const sameParent = resolvePostTopic({ title: 'Baseball and swimming' }, topics, { group });
  assert.equal(sameParent?.topic, 'Sports');
  assert.equal(sameParent?.subtopic, null);
  assert.equal(sameParent?.subtopicAmbiguous, true);
  assert.equal(resolvePostTopic({ title: 'JavaScript', content: '#Python #Django #FastAPI' }, topics), null);
  assert.equal(resolvePostTopic({ topic: 'Python', title: 'JavaScript with Django' }, topics)?.topic, 'Python');
});
