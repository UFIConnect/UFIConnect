export const PUBLISHING_FORMATS = {
  post: 'Post', article: 'Article', release: 'Release', photo: 'Photo', video: 'Video', message: 'Message and comment',
};

export function publishingFormat(platform = {}) {
  const capability = platform.crossPost || {};
  const type = capability.publishType;
  if (capability.requiresVideo || type === 'video-upload') return 'video';
  if (['article', 'blog-post'].includes(type)) return 'article';
  if (type === 'release') return 'release';
  if (capability.requiresPhoto || ['pin', 'shot'].includes(type)) return 'photo';
  if (['channel-message', 'chat-message', 'file-comment'].includes(type)) return 'message';
  return 'post';
}

export function publishingFormatGroups(sources, accounts = {}) {
  const groups = new Map();
  for (const source of new Set(sources || [])) {
    const id = publishingFormat(accounts[source]);
    if (!groups.has(id)) groups.set(id, { id, label: PUBLISHING_FORMATS[id], sources: [] });
    groups.get(id).sources.push(source);
  }
  return [...groups.values()];
}

// Titles are the only shared provider setting. Destinations, tags, visibility,
// audiences, notifications and consent always remain provider-specific.
export function sharedPublishingTitle(group, schemas = {}) {
  const sources = group.sources.filter(source => schemas[source]?.fields?.some(field => field.key === 'title' && field.type === 'text'));
  if (sources.length < 2) return null;
  const fields = sources.map(source => schemas[source].fields.find(field => field.key === 'title'));
  const lengths = fields.map(field => field.maxLength).filter(value => Number.isFinite(value) && value > 0);
  return { key: 'title', label: `${group.label} title`, sources, maxLength: lengths.length ? Math.min(...lengths) : undefined };
}
