// Match the limits used by UFIConnect's publishing adapters. Mastodon also
// validates the connected server's advertised limit when it sends the post.
export function draftPublishingSource(platform) {
  return platform === 'hashnode' ? 'hashnode_blog' : platform === 'general' ? null : platform;
}

export function composerTextLimit(selected = [], media = null) {
  const limits = { uficonnect: 2000, bluesky: 300, threads: 500, twitter: 280, linkedin: 3000, instagram: 2200 };
  let result = { limit: 4000, platform: null };
  for (const platform of selected) {
    let limit = limits[platform] ?? 4000;
    if (platform === 'twitter' && media?.url) limit = Math.max(0, limit - media.url.length - 1);
    if (limit < result.limit) result = { limit, platform };
  }
  return result;
}

export function readSessionDraft(storage, key) {
  try {
    const draft = JSON.parse(storage.getItem(key) || 'null');
    return {
      content: typeof draft?.content === 'string' ? draft.content : '',
      selected: Array.isArray(draft?.selected) ? draft.selected.filter(value => typeof value === 'string') : [],
      media: draft?.media?.url && ['image', 'video'].includes(draft.media.type) ? draft.media : null,
    };
  } catch { return { content: '', selected: [], media: null }; }
}
