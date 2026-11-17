'use strict';

const DISCOVERY_COLLECTION = Object.freeze({
  'Humor & Memes': {
    lane: 'humor',
    reddit: ['CleanJokes', 'wholesomememes', 'AnimalsBeingDerps'],
    bluesky: '#humor',
    mastodon: 'Humor',
  },
  'Everyday Tips': {
    lane: 'practical',
    reddit: ['LifeProTips', 'HowTo', 'Frugal'],
    bluesky: '#DIY',
    mastodon: 'LifeHacks',
  },
  'Facts & Explainers': {
    lane: 'learning',
    reddit: ['todayilearned', 'explainlikeimfive', 'AskHistorians'],
    bluesky: '#DidYouKnow',
    mastodon: 'TodayILearned',
  },
});
const FEATURED_DISCOVERY_TOPICS = Object.freeze(Object.keys(DISCOVERY_COLLECTION));
const DISCOVERY_COLLECTORS = Object.freeze(['reddit', 'bluesky', 'mastodon']);

const curatedTopics = {
  casual: ['Pets & Animals', 'Pet Ownership', 'Photography', 'Books', 'Food & Drink', 'Travel & Adventure'],
  practical: ['Cooking & Recipes', 'Home Improvement', 'Gardening & Plants', 'Home & Garden'],
  learning: ['Astronomy', 'Science & Research', 'Non-Fiction & Learning', 'Museums & Galleries'],
};
const laneByTopic = new Map([
  ...Object.entries(DISCOVERY_COLLECTION).map(([topic, { lane }]) => [topic.toLowerCase(), lane]),
  ...Object.entries(curatedTopics).flatMap(([lane, topics]) => topics.map(topic => [topic.toLowerCase(), lane])),
]);
const DISCOVERY_TOPICS = Object.freeze([...laneByTopic.keys()]);
const laneOrder = ['general', 'humor', 'practical', 'general', 'learning', 'casual'];

function isDiscoveryTopic(topic) {
  return laneByTopic.has(String(topic || '').toLowerCase());
}

function mixDiscoveryPosts(posts) {
  const queues = new Map();
  for (const post of posts) {
    const lane = laneByTopic.get(String(post.topic || '').toLowerCase()) || 'general';
    if (!queues.has(lane)) queues.set(lane, { posts: [], next: 0 });
    queues.get(lane).posts.push(post);
  }
  if (queues.size < 2) return posts;

  const order = laneOrder.map(lane => queues.get(lane)).filter(Boolean);
  const mixed = [];
  while (mixed.length < posts.length) {
    for (const queue of order) {
      if (queue.next < queue.posts.length) mixed.push(queue.posts[queue.next++]);
    }
  }
  return mixed;
}

function buildOpeningDiscoveryPage(posts, featured, limit, sourceLimit) {
  const byTopic = FEATURED_DISCOVERY_TOPICS.map(topic => featured.filter(post => post.topic === topic));
  // Give the topics supplied by fewer sources their choice of slots first.
  byTopic.sort((a, b) => new Set(a.map(post => post.source)).size - new Set(b.map(post => post.source)).size);
  const sourceCounts = new Map();
  const featuredIds = new Set();
  const pageIds = new Set();
  const page = [];
  const canAdd = post => !pageIds.has(post.id) && (sourceCounts.get(post.source) || 0) < sourceLimit;
  const add = post => {
    sourceCounts.set(post.source, (sourceCounts.get(post.source) || 0) + 1);
    pageIds.add(post.id);
    page.push(post);
  };

  for (const candidates of byTopic) {
    if (page.length >= limit - 1) break;
    const post = candidates.find(canAdd);
    if (post) { add(post); featuredIds.add(post.id); }
  }
  for (const post of posts) {
    if (page.length >= limit) break;
    if (canAdd(post)) add(post);
  }
  return { page: mixDiscoveryPosts(page), featuredIds: [...featuredIds] };
}

module.exports = { DISCOVERY_COLLECTION, FEATURED_DISCOVERY_TOPICS, DISCOVERY_COLLECTORS, DISCOVERY_TOPICS,
  isDiscoveryTopic, mixDiscoveryPosts, buildOpeningDiscoveryPage };
