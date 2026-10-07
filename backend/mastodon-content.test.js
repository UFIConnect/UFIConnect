const test = require('node:test');
const assert = require('node:assert/strict');
const { mastodonContentText } = require('./mastodon-content');
const { postTextParts, postTextPreview } = require('./post-text.mjs');

test('Mastodon HTML keeps nested URL destinations, paragraph breaks, and link labels', () => {
  const text = mastodonContentText('<p>Read <a href="https://example.org/full/story?q=one&amp;lang=en"><span class="invisible">https://</span><span>example.org/full</span><span class="ellipsis">/story</span></a>.</p><p><a href="https://example.org/docs">the <strong>full guide</strong></a><br>For #<span>Science</span>.</p>');
  assert.equal(text, 'Read https://example.org/full/story?q=one&lang=en.\n\nthe full guide (https://example.org/docs)\nFor #Science.');
  assert.deepEqual(postTextParts(text).filter(part => part.href).map(part => part.href), ['https://example.org/full/story?q=one&lang=en', 'https://example.org/docs']);
});

test('unsafe anchor destinations and active HTML are never emitted as links', () => {
  const text = mastodonContentText('<script>doBadThings()</script><p><a href="javascript:alert(1)">first</a> <a href="data:text/html,hello">second</a> <a href="https://name:secret@example.org/path">third</a> <a href="https://example.org/&#10;bad">fourth</a> &lt;literal&gt; &#x1f642;</p>');
  assert.equal(text, 'first second third fourth <literal> 🙂');
  assert.deepEqual(postTextParts(text).filter(part => part.href), []);
  assert.doesNotThrow(() => mastodonContentText('<p>&#x110000; &#99999999;</p>'));
});

test('complete URLs preserve query/hash, nested parentheses, and separate prose punctuation', () => {
  const parts = postTextParts('See (https://example.org/wiki/Topic_(detail)?v=2#part). Then https://example.org/end!');
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), ['https://example.org/wiki/Topic_(detail)?v=2#part', 'https://example.org/end']);
  assert.equal(parts.map(part => part.text).join(''), 'See (https://example.org/wiki/Topic_(detail)?v=2#part). Then https://example.org/end!');
});

test('previews never make a truncated URL clickable and keep complete URLs when they fit', () => {
  const full = 'Read https://example.org/a-very-long-path?part=correct#details and then continue.';
  const short = postTextPreview(full, 30);
  assert.equal(short, 'Read');
  assert.deepEqual(postTextParts(short).filter(part => part.href), []);
  const stored = mastodonContentText(`<p>${full}</p>`, 30);
  assert.equal(stored, 'Read…');
  assert.equal(postTextPreview('A https://example.org/ end', 24), 'A https://example.org/ e');
  assert.equal(postTextParts(postTextPreview('A https://example.org/ end', 24)).find(part => part.href)?.href, 'https://example.org/');
  assert.deepEqual(postTextParts('https://example.org/truncated… https://example.org/short...').filter(part => part.href), []);
});

test('URLs with credentials, bidi controls, or non-HTTP schemes stay inert text', () => {
  const text = 'javascript:alert(1) data:text/html,bad https://name:pass@example.org https://example.org/ab\u202ecd';
  assert.deepEqual(postTextParts(text).filter(part => part.href), []);
  assert.equal(postTextParts(text).map(part => part.text).join(''), text);
});
