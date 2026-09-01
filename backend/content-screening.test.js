'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanScreeningText,
  localTextScreen,
  screenImportedFeedPost,
  screenExternalComment,
} = require('./content-screening');

test('normalizes invisible control characters without changing readable content', () => {
  assert.equal(cleanScreeningText('Hello\u200B\u0000 world'), 'Hello world');
});

test('blocks unsafe source URLs before imported content enters a feed', () => {
  const result = screenImportedFeedPost({
    id: 'unsafe-1', source: 'example', title: 'Unsafe link', content: 'Nope', sourceUrl: 'javascript:alert(1)',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'unsafe_url');
});

test('screens repeated and link-spam member text', () => {
  assert.equal(localTextScreen('hello '.repeat(10)).reason, 'repetitive_content');
  assert.equal(localTextScreen('https://a.test https://b.test https://c.test https://d.test https://e.test').reason, 'link_spam');
});

test('keeps valid imported posts and sanitizes their display text', () => {
  const result = screenImportedFeedPost({
    id: 'good-1', source: 'news', title: 'A useful update\u200B', content: 'A concise summary of the update.',
    author: { name: 'Publisher\u200B' }, sourceUrl: 'https://example.com/story',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.post.title, 'A useful update');
  assert.equal(result.post.author.name, 'Publisher');
});

test('caps verbose imported copy without dropping the source post', () => {
  const result = screenImportedFeedPost({
    id: 'long-1', source: 'news',
    title: 'A useful source headline '.repeat(40),
    content: 'A concise source sentence with practical context. '.repeat(60),
  });
  assert.equal(result.allowed, true);
  assert.ok(result.post.title.length <= 500);
  assert.ok(result.post.content.length <= 2000);
});

test('screens externally fetched comment text before it is sent to clients', () => {
  const result = screenExternalComment({ id: 'comment-1', body: 'Helpful context\u200B' });
  assert.equal(result.allowed, true);
  assert.equal(result.comment.body, 'Helpful context');
});
