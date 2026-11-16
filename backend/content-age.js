'use strict';

const { officialVideoReference, publicMediaUrl, suppliedVideoFileUrl, suppliedHlsUrl } = require('./video-media-urls.mjs');

const ADULT_AGE = 18;
const MINIMUM_AGE_16 = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB'.split(' '),
);
const ADULT_BLUESKY_LABELS = new Set(['porn', 'sexual', 'graphic-media']);
const RATED_FEED_SOURCES = new Set(['youtube', 'reddit', 'mastodon', 'bluesky', 'twitter', 'twitch']);

function ageInYears(birthDate, now = new Date()) {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const birthday = new Date(`${birthDate}T00:00:00.000Z`);
  if (!Number.isFinite(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== birthDate) return null;
  const today = now.toISOString().slice(0, 10);
  const age = now.getUTCFullYear() - birthday.getUTCFullYear() - Number(today.slice(5) < birthDate.slice(5));
  return age >= 0 && age <= 125 && birthDate <= today ? age : null;
}

function validateBirthDate(birthDate, country, now) {
  const age = ageInYears(birthDate, now);
  if (age === null) return 'Enter a valid date of birth.';
  const minimum = !country || MINIMUM_AGE_16.has(country) ? 16 : 13;
  if (age < minimum) return 'You do not meet the minimum age to create an account in your region.';
  return null;
}

function youtubeMinimumViewerAge(contentDetails) {
  if (!contentDetails || typeof contentDetails !== 'object') return null;
  return contentDetails.contentRating?.ytRating === 'ytAgeRestricted' ? ADULT_AGE : 0;
}

function blueskyMinimumViewerAge(post) {
  const labels = [post?.labels, post?.author?.labels, post?.record?.labels?.values].flatMap(value => Array.isArray(value) ? value : []);
  return labels.some(label => !label?.neg && ADULT_BLUESKY_LABELS.has(label?.val)) ? ADULT_AGE : null;
}

function isAgeRestricted(post) {
  return Number.isInteger(post?.minimumViewerAge) && post.minimumViewerAge > 0;
}

function canViewByAge(post, age) {
  return !isAgeRestricted(post) || (Number.isInteger(age) && age >= post.minimumViewerAge);
}

function ratingLookupIds(post) {
  if (!post || post.isExternal === false) return [];
  const ids = post.id && RATED_FEED_SOURCES.has(post.source) ? [post.id] : [];
  const reference = officialVideoReference(post.sourceUrl) || officialVideoReference(post.mediaUrl);
  if (reference?.kind === 'youtube') ids.push(`youtube_${reference.id}`);
  return ids;
}

async function readFeedAgeRestrictions(db, posts) {
  const ids = [...new Set(posts.flatMap(ratingLookupIds))];
  if (!ids.length || !db.isConnected()) return new Map();
  try {
    // A shared snapshot may contain a copy from before a rating was known.
    const { rows } = await (db.readQuery || db.query)(
      `SELECT id, minimum_viewer_age FROM feed_posts_cache
       WHERE id=ANY($1::text[]) AND minimum_viewer_age > 0`,
      [ids],
    );
    return new Map(rows.filter(row => row.minimum_viewer_age > 0).map(row => [row.id, row.minimum_viewer_age]));
  } catch (error) {
    if (error.code === '42703') return new Map();
    return null;
  }
}

function applyFeedAgeRestriction(post, ratings) {
  const ids = ratingLookupIds(post);
  const assumedAge = !ratings && ids.length && post.minimumViewerAge == null && post.mediaType === 'video' ? ADULT_AGE : 0;
  const minAge = Math.max(post.minimumViewerAge || 0, assumedAge, ...ids.map(id => ratings?.get(id) || 0));
  return minAge > 0 && minAge !== post.minimumViewerAge ? { ...post, minimumViewerAge: minAge } : post;
}

// Restricted cards carry the original link and attribution. The provider
// controls playback and applies its own age checks.
function sourceOnlyPost(post) {
  if (!isAgeRestricted(post)) return post;
  const { id, groupId, group, source, sourceLabel, topic, createdAt,
    minimumViewerAge, videoDurationSeconds, mediaType, isExternal, visibility,
    likesCount, commentsCount, savedByMe, savedAt } = post;
  const reference = officialVideoReference(post.sourceUrl) || officialVideoReference(post.mediaUrl);
  const sourceUrl = reference?.kind === 'youtube' ? `https://www.youtube.com/watch?v=${reference.id}`
    : suppliedVideoFileUrl(post.sourceUrl) || suppliedHlsUrl(post.sourceUrl) ? null : publicMediaUrl(post.sourceUrl);
  return {
    id, groupId, group, source, sourceLabel, sourceUrl, topic, createdAt,
    minimumViewerAge, videoDurationSeconds, mediaType, isExternal, visibility,
    likesCount, commentsCount, savedByMe, savedAt,
    authorId: post.authorId,
    author: post.author ? { id: post.author.id, name: post.author.name } : null,
    title: mediaType === 'video' ? 'Age-restricted video' : 'Age-restricted post',
    sourcePlaybackOnly: true,
  };
}

module.exports = { ADULT_AGE, ageInYears, validateBirthDate, youtubeMinimumViewerAge,
  blueskyMinimumViewerAge, isAgeRestricted, canViewByAge, sourceOnlyPost, readFeedAgeRestrictions, applyFeedAgeRestriction };
