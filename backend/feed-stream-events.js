'use strict';

const FEED_STREAM_EVENT_MAX_BYTES = 64 * 1024;

// Feed clients use these identities to wake an authorized refresh. Sending
// full source bodies here adds no information the refresh does not return.
function* feedUpdateFrames(posts, { init = false, maxBytes = FEED_STREAM_EVENT_MAX_BYTES } = {}) {
  const prefix = init ? 'data: {"init":true,"posts":[' : 'data: {"posts":[';
  const suffix = ']}\n\n';
  const overhead = Buffer.byteLength(prefix + suffix);
  let entries = [], bytes = overhead;
  for (const post of posts) {
    if (typeof post?.id !== 'string' || !post.id) continue;
    const entry = JSON.stringify({ id: post.id, ...(typeof post.source === 'string' ? { source: post.source } : {}) });
    const size = Buffer.byteLength(entry);
    // Reject an invalid identity that cannot fit even by itself. A source
    // body's size and escaping never affect the notification envelope.
    if (size + overhead > maxBytes) continue;
    if (entries.length && bytes + size + 1 > maxBytes) {
      yield prefix + entries.join(',') + suffix;
      entries = []; bytes = overhead;
    }
    bytes += size + (entries.length ? 1 : 0);
    entries.push(entry);
  }
  if (entries.length) yield prefix + entries.join(',') + suffix;
}

module.exports = { FEED_STREAM_EVENT_MAX_BYTES, feedUpdateFrames };
