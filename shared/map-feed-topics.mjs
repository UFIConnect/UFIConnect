// Map labels may be broader than the labels stamped by source workers. Expand
// explicit aliases, never title substrings ("Art" must not match "article").
const ALIASES = {
  Technology: ['AI & Machine Learning', 'Developer Tools', 'Open Source', 'Cybersecurity', 'Cloud & DevOps', 'Frontend Dev', 'Backend Dev', 'Mobile Dev', 'Hardware / IoT'],
  Programming: ['Python', 'JavaScript', 'TypeScript', 'Rust', 'Go', 'React', 'Node', 'Developer Tools'],
  Design: ['UI/UX Design', 'Design Systems', 'Brand Identity', 'Graphic Design', 'Motion Design'],
  Business: ['Business Strategy', 'SaaS', 'Startup', 'Startups', 'Leadership', 'Product Management'],
  Travel: ['Travel & Adventure'], Adventure: ['Travel & Adventure'],
  Science: ['Science & Research'], Research: ['Science & Research'],
  Music: ['Music Discovery', 'Music Production'], Video: ['YouTube & Video', 'Film & Video'],
  Cooking: ['Cooking & Recipes'], Recipes: ['Cooking & Recipes'],
  Fitness: ['Fitness & Gym'], 'Web Development': ['Frontend Dev', 'Backend Dev'],
  DevOps: ['Cloud & DevOps'], Databases: ['Database'], 'UX/UI': ['UI/UX Design'],
  Writing: ['Newsletter & Writing', 'Poetry & Creative Writing'],
  Storytelling: ['Fiction & Storytelling', 'Visual Storytelling'],
  Football: ['Football & Soccer'], Soccer: ['Football & Soccer'], Tennis: ['Tennis & Golf'],
  'Game Development': ['Game Dev'], Esports: ['Esports & Competitive Gaming'],
  Nightlife: ['Wine & Spirits', 'Live Events & Concerts'],
  'Live Music': ['Live Events & Concerts'], 'Local Events': ['Cultural Events', 'Live Events & Concerts'],
  Culture: ['Cultural Tourism', 'Cultural Events'], Baking: ['Baking & Pastry'], Nutrition: ['Nutrition & Diet'],
  Education: ['EdTech'], Careers: ['Career Growth', 'Recruiting & Hiring', 'Future of Work'],
};
export const normalizeMapTopic = value => String(value || '').trim().toLowerCase();
export const mapTopicLabels = topic => [...new Set([topic, ...(ALIASES[topic] || [])].map(normalizeMapTopic).filter(Boolean))];
export function mapTopicMatches(post, topic) {
  const labels = new Set(mapTopicLabels(topic));
  const values = post.topic ? [post.topic] : Array.isArray(post.topics) ? post.topics : [];
  return values.some(value => labels.has(normalizeMapTopic(value)));
}
export const mapPostTarget = value => Number.isFinite(Number(value)) ? Math.min(500, Math.max(20, Math.round(Number(value)))) : 20;
export const mapWildcardTarget = (settings, category, source = 'city') => mapPostTarget(settings.topicTargets?.[category + ':' + source]?.['*'] ?? settings.topicTargets?.[category + ':city']?.['*']);
export function mapTopicCounts(posts, category) {
  const counts = new Map();
  for (const post of posts) {
    if (post.category !== category) continue;
    for (const topic of new Set(post.topic ? [post.topic] : post.topics || [])) {
      const label = normalizeMapTopic(topic);
      for (const source of ['city', post.source]) {
        const key = source + ':' + label;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return (topic, source = 'city') => mapTopicLabels(topic).reduce((sum, label) => sum + (counts.get(source + ':' + label) || 0), 0);
}
// City topics and house topics both apply. Completed quotas are removed before
// the database LIMIT, so a busy completed topic cannot hide a quieter one.
export function mapSourceTopicScope(settings, category, sources, posts = []) {
  const count = mapTopicCounts(posts, category);
  const sourceCounts = new Map();
  for (const post of posts) sourceCounts.set(post.source, (sourceCounts.get(post.source) || 0) + 1);
  const selection = source => settings.topicSelections?.[category + ':' + source] || [];
  const remaining = source => {
    const topics = selection(source);
    if (!topics.length) return null;
    const exhausted = new Set(topics.filter(topic => count(topic, source) >= mapPostTarget(settings.topicTargets?.[category + ':' + source]?.[topic])).flatMap(mapTopicLabels));
    return [...new Set(topics.flatMap(mapTopicLabels))].filter(label => !exhausted.has(label));
  };
  const city = remaining('city');
  return Object.fromEntries(sources.map(source => {
    const house = remaining(source);
    const explicitSourceLimit = house === null && settings.topicTargets?.[category + ':' + source]?.['*'] != null;
    if ((city === null && house === null || explicitSourceLimit) && (sourceCounts.get(source) || 0) >= mapWildcardTarget(settings, category, source)) return [source, []];
    if (city === null && !sources.some(id => selection(id).length) && posts.length >= mapPostTarget(settings.topicTargets?.[category + ':city']?.['*'])) return [source, []];
    return [source, city === null ? house : house === null ? city : city.filter(label => house.includes(label))];
  }));
}
export function appendMapPosts(previous, incoming, settings, category, sources) {
  const result = [...previous], seen = new Set(previous.map(post => post.key));
  const counts = new Map();
  const sourceCounts = new Map();
  for (const post of previous) sourceCounts.set(post.source, (sourceCounts.get(post.source) || 0) + 1);
  const countTopic = mapTopicCounts(previous, category);
  const scopes = ['city', ...sources].map(source => ({ source, key: category + ':' + source,
    topics: settings.topicSelections?.[category + ':' + source] || [] }));
  const countKey = (scope, topic) => scope.source + ':' + topic;
  for (const scope of scopes) for (const topic of scope.topics) {
    counts.set(countKey(scope, topic), countTopic(topic, scope.source));
  }
  const anyTopics = scopes.some(scope => scope.topics.length);
  const totalTarget = mapPostTarget(settings.topicTargets?.[category + ':city']?.['*']);
  for (const post of incoming) {
    if (seen.has(post.key) || !sources.includes(post.source)) continue;
    const applicable = scopes.filter(scope => scope.source === 'city' || scope.source === post.source);
    if (applicable.some(scope => scope.topics.length && !scope.topics.some(topic => mapTopicMatches(post, topic)))) continue;
    const matched = applicable.flatMap(scope => scope.topics.filter(topic => mapTopicMatches(post, topic)).map(topic => ({ scope, topic })));
    if (matched.some(({ scope, topic }) => (counts.get(countKey(scope, topic)) || 0) >= mapPostTarget(settings.topicTargets?.[scope.key]?.[topic]))) continue;
    if (!anyTopics && result.length >= totalTarget) break;
    const explicitSourceLimit = !settings.topicSelections?.[category + ':' + post.source]?.length && settings.topicTargets?.[category + ':' + post.source]?.['*'] != null;
    if (explicitSourceLimit && (sourceCounts.get(post.source) || 0) >= mapWildcardTarget(settings, category, post.source)) continue;
    if (!matched.length && (sourceCounts.get(post.source) || 0) >= mapWildcardTarget(settings, category, post.source)) continue;
    seen.add(post.key); result.push(post);
    sourceCounts.set(post.source, (sourceCounts.get(post.source) || 0) + 1);
    for (const { scope, topic } of matched) counts.set(countKey(scope, topic), (counts.get(countKey(scope, topic)) || 0) + 1);
  }
  return result;
}
export function parseMapSourceTopics(value, sources) {
  if (typeof value !== 'string' || value.length > 16000) throw new Error('Invalid map topics');
  const input = JSON.parse(value);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid map topics');
  return Object.fromEntries(sources.map(source => {
    const topics = input[source];
    if (topics == null) return [source, null];
    if (!Array.isArray(topics) || topics.length > 200 || topics.some(topic => typeof topic !== 'string' || !topic.trim() || topic.length > 100)) throw new Error('Invalid map topics');
    return [source, [...new Set(topics.map(normalizeMapTopic))]];
  }));
}
