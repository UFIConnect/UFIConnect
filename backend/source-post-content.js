'use strict';
const { postTextPreview } = require('./post-text.mjs');
const { isCareerListing } = require('./job-sources.mjs');

// A source may supply a complete article or only a preview. Preserve what it
// actually supplies; this limit never triggers a fetch of the linked website.
const SOURCE_CONTENT_MAX_CHARS = 100_000;
function boundedSourceText(value, limit = SOURCE_CONTENT_MAX_CHARS) {
  const text = String(value ?? '');
  return text.length > limit ? `${postTextPreview(text, Math.max(0, limit - 1))}\u2026` : text;
}

// Older imports were cut at 300, 1,500 or 2,000 characters. Retain a bounded
// window of references to those existing posts so a normal provider refresh
// can repair their body without re-inserting or re-attributing the post.
function createImportedContentRecovery({ maxEntries = 5000, maxTextChars = 5_000_000 } = {}) {
  const posts = new Map();
  const limit = Math.max(1, Math.min(10_000, Number(maxEntries) || 5000));
  const textLimit = Math.max(1, Math.min(5_000_000, Number(maxTextChars) || 5_000_000));
  let textChars = 0;
  function forget(id) {
    const entry = posts.get(id);
    if (!entry) return false;
    textChars -= entry.chars;
    return posts.delete(id);
  }
  function remember(post) {
    const chars = String(post?.content || '').length;
    if (!post?.id || post.source === 'uficonnect' || post.isExternal === false
      || !post.sourceUrl || chars > (isCareerListing(post) ? 60001 : 2001)) return;
    forget(post.id);
    posts.set(post.id, { post, chars });
    textChars += chars;
    while (posts.size > limit || textChars > textLimit) forget(posts.keys().next().value);
  }
  function take(incoming) {
    const previous = posts.get(incoming?.id)?.post;
    if (!previous || incoming.source !== previous.source || incoming.sourceUrl !== previous.sourceUrl
      || incoming.source === 'uficonnect' || incoming.isExternal === false) return null;
    for (const field of ['id', 'name', 'profileUrl']) {
      const before = previous.author?.[field], after = incoming.author?.[field];
      if (before && after && before !== after) return null;
    }
    const content = boundedSourceText(incoming.content);
    if (content.length <= String(previous.content || '').length) return null;
    // The caller screens incoming text first. Only body text changes: all
    // original identity, ordering, media and engagement fields stay intact.
    forget(incoming.id);
    return { post: { ...previous, content }, previousContent: String(previous.content || ''), cachedPost: previous };
  }
  return { remember, take, forget, get size() { return posts.size; }, get textChars() { return textChars; } };
}
module.exports = { SOURCE_CONTENT_MAX_CHARS, boundedSourceText, createImportedContentRecovery };
