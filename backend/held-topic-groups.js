'use strict';

const { createHash } = require('node:crypto');
const { classifyTopic, rankTopicCandidates } = require('./office-topic-transfer');

// These are review aids, not admission decisions. In particular, keyword and
// source buckets never invent a topic or bypass normal post screening.
const STOP_WORDS = new Set(('about after again against also another around because before being between could during every first found from getting going great have here http https into just know latest like live more most much need news next only other over post really said says should some still such than that their them then there these they thing this those through time today under update very want well were what when where which while will with world would your youtube untitled original plain complete retained content some').split(' '));
const clean = value => String(value || '').replace(/https?:\/\/\S+/giu, ' ').replace(/<[^>]*>/g, ' ').normalize('NFKC');
const key = (method, value) => createHash('sha256').update(`review-groups-v1\0${method}\0${value}`).digest('hex');

function heldPostGroup(post, topics) {
  const decision = classifyTopic(post, topics);
  if (decision) return { id: key('topic', decision.topic), label: decision.topic, topic: decision.topic, method: 'topic' };
  const candidates = rankTopicCandidates(post, topics);
  if (candidates.length > 1) {
    const leading = candidates.filter(candidate => candidates[0].score - candidate.score < 2).map(candidate => candidate.topic).sort();
    if (leading.length > 1) return { id:key('ambiguous',JSON.stringify(leading)),label:leading.join(' / '),topic:null,method:'ambiguous' };
  }
  const title = clean(post?.title), text = clean(post?.content);
  const hashtag = `${title} ${text}`.match(/(?:^|\s)#([\p{L}][\p{L}\p{N}_]{2,59})(?=$|[^\p{L}\p{N}_])/u)?.[1]?.toLowerCase();
  if (hashtag && !STOP_WORDS.has(hashtag)) return { id: key('hashtag', hashtag), label: `#${hashtag}`, topic: null, method: 'hashtag' };
  // Prefer the title's subject. Do not let URLs or provider names supply
  // classification evidence when a post has no descriptive text.
  for (const value of [title, text.slice(0, 2000)]) {
    const words = (value.toLowerCase().match(/[\p{L}][\p{L}\p{N}]{2,39}/gu) || []).filter(word => !STOP_WORDS.has(word));
    const keyword = words.find(word => word.length >= 5) || words[0];
    if (keyword) return { id: key('keyword', keyword), label: `Keyword: ${keyword}`, topic: null, method: 'keyword' };
  }
  const source = String(post?.source || '').trim().slice(0, 100);
  return { id: key('source', source), label: source ? `No text: ${source}` : 'No text: source unknown', topic: null, method: 'source' };
}

module.exports = { heldPostGroup };
