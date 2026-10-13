function canonicalUrl(value) {
  try { const url = new URL(value); url.search = ''; url.hash = ''; return url.href.replace(/\/$/, ''); }
  catch { return ''; }
}

function createCommentCache({ getCached, setCached, deleteCached, screenComment, ttlMs, maxEntries = 200 }) {
  const entries = new Map();
  async function read(key, loader, offset, limit, metadata = {}) {
    const scopedKey = `${key}:viewer:${metadata.viewerId || 'public'}`;
    let entry = entries.get(scopedKey);
    if (!entry) {
      entry = { version: 0, promise: null, source: metadata.source || '', url: canonicalUrl(metadata.sourceUrl) };
      entries.set(scopedKey, entry);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }
    let full = getCached(scopedKey);
    if (!full) {
      if (!entry.promise) {
        const version = entry.version;
        const promise = Promise.resolve().then(loader).then(comments => {
          const screened = (Array.isArray(comments) ? comments : []).flatMap(comment => {
            const result = screenComment(comment);
            return result.allowed ? [result.comment] : [];
          });
          if (entries.get(scopedKey) === entry && entry.version === version) {
            // Scarce anonymous API budgets retain their existing read cache.
            const cacheTtl = ['github', 'stackoverflow'].includes(entry.source) ? Math.max(ttlMs, 120000) : ttlMs;
            setCached(scopedKey, screened, cacheTtl);
          }
          return screened;
        }).finally(() => { if (entry.promise === promise) entry.promise = null; });
        entry.promise = promise;
      }
      full = await entry.promise;
    }
    return { comments: full.slice(offset, offset + limit), hasMore: offset + limit < full.length, total: full.length };
  }
  function invalidate({ source, sourceUrl }) {
    const url = canonicalUrl(sourceUrl);
    if (!url) return;
    for (const [key, entry] of entries) {
      if (entry.source !== source || entry.url !== url) continue;
      entry.version++; entry.promise = null; deleteCached(key);
    }
  }
  return { read, invalidate };
}
module.exports = { createCommentCache };
