export const topicMatches = (post, topic) => (post.topics || []).some(value => value.toLowerCase() === topic.toLowerCase())
  || `${post.title || ''} ${post.content || ''}`.toLowerCase().includes(topic.toLowerCase());
export function topicCount(posts, topic, category, source = '') {
  return posts.filter(post => post.category === category && (!source || post.source === source) && topicMatches(post, topic)).length;
}
export function topicTarget(targets, key, topic) {
  const value = targets?.[key]?.[topic];
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : 20;
}
export function fitsTopicTargets(post, selected, category, selections, targets) {
  for (const key of [category + ':city', category + ':' + post.source]) {
    const source = key.endsWith(':city') ? '' : post.source;
    for (const topic of Array.isArray(selections[key]) ? selections[key] : []) {
      if (topicMatches(post, topic) && topicCount(selected, topic, category, source) >= topicTarget(targets, key, topic)) return false;
    }
  }
  return true;
}
