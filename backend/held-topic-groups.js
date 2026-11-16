'use strict';

const { createHash } = require('node:crypto');
const { assessPostTopic } = require('./office-topic-transfer');

// These are review aids, not admission decisions. In particular, keyword and
// source buckets never invent a topic or bypass normal post screening.
const STOP_WORDS = new Set(('about after again against also another around because before being between could during every first found from getting going great have here http https into just know latest like live more most much need news next only other over post really said says should some still such than that their them then there these they thing this those through time today under update very want well were what when where which while will with world would your youtube untitled original plain complete retained content some').split(' '));
const clean = value => String(value || '').slice(0, 16000).replace(/https?:\/\/\S+/giu, ' ').replace(/<[^<>]*>/g, ' ').normalize('NFKC');
const key = (method, value) => createHash('sha256').update(`review-groups-v2\0${method}\0${value}`).digest('hex');

function heldPostGroup(post, topics, group) {
  const { decision, competing } = assessPostTopic(post, topics, { group });
  if (decision) {
    const { topic, subtopic } = decision;
    if (decision.subtopicAmbiguous) return { id: key('ambiguous-subtopic', topic), label: `${topic} / Needs subtopic review`,
      topic, subtopic: null, method: 'ambiguous' };
    return { id: key('topic', JSON.stringify([topic, subtopic])), label: subtopic ? `${topic} / ${subtopic}` : topic,
      topic, subtopic, method: 'topic' };
  }
  if (competing?.length) {
    const labels = competing.sort();
    return { id: key('ambiguous', JSON.stringify(labels)), label: labels.join(' / '), topic: null, method: 'ambiguous' };
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
