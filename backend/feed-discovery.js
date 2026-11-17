'use strict';

const DISCOVERY_COLLECTION = Object.freeze({
  'Humor & Memes': {
    lane: 'humor',
    reddit: ['CleanJokes', 'wholesomememes', 'AnimalsBeingDerps'],
    bluesky: '#wholesomememes',
    mastodon: 'Humor',
  },
  'Everyday Tips': {
    lane: 'practical',
    reddit: ['LifeProTips', 'HowTo', 'Frugal'],
    bluesky: '#LifeHacks',
    mastodon: 'LifeHacks',
  },
  'Facts & Explainers': {
    lane: 'learning',
    reddit: ['todayilearned', 'explainlikeimfive', 'AskHistorians'],
    bluesky: '#TodayILearned',
    mastodon: 'TodayILearned',
  },
});

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

module.exports = { DISCOVERY_COLLECTION, DISCOVERY_TOPICS, isDiscoveryTopic, mixDiscoveryPosts };
