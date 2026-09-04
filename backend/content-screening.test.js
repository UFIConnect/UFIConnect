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
    sourceUrl: 'https://example.com/long-story',
  });
  assert.equal(result.allowed, true);
  assert.ok(result.post.title.length <= 500);
  assert.ok(result.post.content.length <= 2000);
});

test('requires a publisher link for imported posts', () => {
  const result = screenImportedFeedPost({
    id: 'unlinked-1', source: 'news', title: 'A useful update', content: 'Useful context.',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'missing_source_url');
});

test('blocks account-marketplace spam found in otherwise real source feeds', () => {
  const result = screenImportedFeedPost({
    id: 'spam-1', source: 'devto',
    title: 'Top trusted websites to buy verified Wise accounts',
    content: 'A list of sellers and account packages.',
    sourceUrl: 'https://example.com/spam',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'spam_or_solicitation');
});

test('blocks placeholder, malformed-link, and future-dated imports', () => {
  assert.equal(screenImportedFeedPost({
    id: 'placeholder-1', source: 'news', title: 'Coming soon', sourceUrl: 'https://example.com/soon',
  }).reason, 'placeholder_content');
  assert.equal(screenImportedFeedPost({
    id: 'bad-link-1', source: 'news', title: 'Real headline', sourceUrl: '/relative/story',
  }).reason, 'invalid_source_url');
  assert.equal(screenImportedFeedPost({
    id: 'future-1', source: 'news', title: 'Future headline', sourceUrl: 'https://example.com/future',
    createdAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }).reason, 'future_timestamp');
});

test('screens externally fetched comment text before it is sent to clients', () => {
  const result = screenExternalComment({ id: 'comment-1', body: 'Helpful context\u200B' });
  assert.equal(result.allowed, true);
  assert.equal(result.comment.body, 'Helpful context');
});
