import test from 'node:test';
import assert from 'node:assert/strict';
import { postLinkDestination, postLinkPreviews } from './postLinkPreview.mjs';
import { postTextPreview } from '../../../backend/post-text.mjs';

test('readable destination keeps meaningful parameters and preserves the exact link', () => {
  const href = 'https://example.com/reports/annual%20review?q=climate&edition=2026&utm_source=feed#findings';
  const result = postLinkDestination(href);
  assert.equal(result.href, href);
  assert.equal(result.domain, 'example.com');
  assert.equal(result.path, '/reports/annual review?q=climate&edition=2026#findings');
  assert.ok(!result.label.includes('utm_source'));
  assert.equal(postLinkDestination('https://example.com/?id=23').path, '/?id=23');
});

test('normalizes destinations without disguising domains or alternate ports', () => {
  const result = postLinkDestination('https://аpple.com/account'); // First letter is Cyrillic.
  assert.ok(result.domain.startsWith('xn--'));
  assert.ok(result.label.startsWith(result.domain));
  assert.equal(postLinkDestination('https://example.com:8443/account').domain, 'example.com:8443');
  assert.equal(postLinkDestination('https://example.com/%E2%80%AEevil').path, '/%E2%80%AEevil');
});

test('rejects credentials, dangerous protocols, raw control characters and bidi text', () => {
  for (const href of ['https://trusted.com@evil.test/', 'javascript:alert(1)', 'data:text/html,hi', '/relative', 'https://example.com/\nnext', 'https://example.com/\u202Eevil']) {
    assert.equal(postLinkDestination(href), null, href);
  }
});

test('deduplicates complete links, excludes original post, and preserves distinct query destinations', () => {
  const original = 'https://mastodon.social/@example/123';
  const links = postLinkPreviews(`Read https://example.com/?id=1, and https://example.com/?id=1. Also https://example.com/?id=2 and ${original}`, original);
  assert.deepEqual(links.map(link => link.href), ['https://example.com/?id=1', 'https://example.com/?id=2']);
});

test('does not turn truncated URLs into previews or preview URLs cut off by collapsed text', () => {
  assert.deepEqual(postLinkPreviews('https://example.com/article… https://example.com/article...'), []);
  const text = 'Read https://example.com/long-article-path today';
  assert.deepEqual(postLinkPreviews(postTextPreview(text, 20)), []);
  assert.equal(postLinkPreviews(text)[0].href, 'https://example.com/long-article-path');
});

test('display text stays bounded and URL markup remains plain data', () => {
  const href = `https://example.com/${'long-article-'.repeat(70)}`;
  const preview = postLinkDestination(href);
  assert.ok(preview.path.length <= 180);
  assert.ok(preview.label.length <= preview.domain.length + 78);
  assert.equal(preview.href, href);
  assert.equal(postLinkDestination('https://example.com/%3Cscript%3E').path, '/<script>');
  assert.equal(postLinkDestination('https://example.com/%E0%A4%A').path, '/%E0%A4%A');
});
