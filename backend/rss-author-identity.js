'use strict';
const { createHash } = require('node:crypto');

// RSS author names are the available identity, not a verified account ID.
// Scope them to their provider and never invent one author for an entire feed.
function rssAuthorIdentity(item, sourceId) {
  if (typeof item?.author !== 'string' || typeof sourceId !== 'string') return null;
  let source = sourceId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(source)) return null;
  if (source === 'hn') source = 'hackernews';
  const author = item.author.normalize('NFKC').replace(/\u0000/g, '').replace(/\s+/gu, ' ').trim().toLowerCase();
  if (!author) return null;
  return `${source}_author_${createHash('sha256').update(author).digest('hex').slice(0, 24)}`;
}

module.exports = { rssAuthorIdentity };
