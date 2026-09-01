'use strict';

// This module intentionally contains only deterministic, cheap checks. It is
// used on every external-feed item, so it must stay safe to call in a hot path.
const INVISIBLE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const UNSAFE_URL_SCHEME = /^\s*(?:javascript|vbscript|data|file):/i;
const REPEATED_CHARACTER = /(.)\1{17,}/u;
const REPEATED_WORD = /\b([\p{L}\p{N}][\p{L}\p{N}'-]{1,})\b(?:\s+\1\b){7,}/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>]+/gi;

const SCAM_PATTERNS = [
  /\b(?:guaranteed|risk[- ]?free)\b.{0,72}\b(?:profit|return|income)\b/i,
  /\b(?:send|deposit)\b.{0,72}\b(?:bitcoin|crypto|usdt|ethereum)\b/i,
  /\b(?:dm|message|contact)\s+(?:me|us)\b.{0,96}\b(?:whatsapp|telegram)\b/i,
  /\b(?:onlyfans|pornhub|cam\s*girl|escort)\b/i,
];

function cleanScreeningText(value, maxLength = null) {
  let text = String(value ?? '');
  try { text = text.normalize('NFKC'); } catch { /* keep the original text */ }
  text = text
    .replace(INVISIBLE_OR_CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return Number.isFinite(maxLength) ? text.slice(0, Math.max(0, maxLength)) : text;
}

function hasUnsafeUrl(value) {
  return typeof value === 'string' && UNSAFE_URL_SCHEME.test(value);
}

function localTextScreen(text, { maxLength = null, allowEmpty = false } = {}) {
  const clean = cleanScreeningText(text);
  if (!allowEmpty && !clean) return { allowed: false, reason: 'empty_content', text: clean };
  if (maxLength && clean.length > maxLength) return { allowed: false, reason: 'too_long', text: clean };
  if (!clean) return { allowed: true, reason: null, text: clean };
  if (REPEATED_CHARACTER.test(clean) || REPEATED_WORD.test(clean)) {
    return { allowed: false, reason: 'repetitive_content', text: clean };
  }
  const urlCount = (clean.match(URL_PATTERN) || []).length;
  if (urlCount > 4) return { allowed: false, reason: 'link_spam', text: clean };
  if (SCAM_PATTERNS.some(pattern => pattern.test(clean))) {
    return { allowed: false, reason: 'spam_or_solicitation', text: clean };
  }
  return { allowed: true, reason: null, text: clean };
}

function screenImportedFeedPost(rawPost) {
  if (!rawPost || typeof rawPost !== 'object') return { allowed: false, reason: 'invalid_post', post: rawPost };
  if (!String(rawPost.id || '').trim() || !String(rawPost.source || '').trim()) {
    return { allowed: false, reason: 'missing_identity', post: rawPost };
  }
  if (String(rawPost.screeningStatus || rawPost.screening_status || '').toLowerCase() === 'blocked') {
    return { allowed: false, reason: 'previously_blocked', post: rawPost };
  }

  // Source payloads can be verbose. Normalize them to the same storage/UI
  // ceiling instead of discarding an otherwise valid article just for being
  // long; user-authored content is rejected over its explicit write limit.
  const title = localTextScreen(cleanScreeningText(rawPost.title, 500), { maxLength: 500, allowEmpty: true });
  const content = localTextScreen(cleanScreeningText(rawPost.content, 2000), { maxLength: 2000, allowEmpty: true });
  if (!title.allowed) return { allowed: false, reason: title.reason, post: rawPost };
  if (!content.allowed) return { allowed: false, reason: content.reason, post: rawPost };
  if (!title.text && !content.text) return { allowed: false, reason: 'empty_content', post: rawPost };
  if ([rawPost.sourceUrl, rawPost.mediaUrl, rawPost.mediaPoster].some(hasUnsafeUrl)) {
    return { allowed: false, reason: 'unsafe_url', post: rawPost };
  }

  const author = rawPost.author && typeof rawPost.author === 'object'
    ? { ...rawPost.author, name: cleanScreeningText(rawPost.author.name, 160) }
    : rawPost.author;
  const post = {
    ...rawPost,
    title: title.text,
    content: content.text,
    author,
    screeningStatus: rawPost.screeningStatus || 'approved',
    screeningMethod: rawPost.screeningMethod || 'local',
    screenedAt: rawPost.screenedAt || new Date().toISOString(),
  };
  return { allowed: true, reason: null, post };
}

function screenExternalComment(rawComment) {
  if (!rawComment || typeof rawComment !== 'object') return { allowed: false, reason: 'invalid_comment', comment: rawComment };
  const bodyKey = typeof rawComment.body === 'string' ? 'body' : 'content';
  const screened = localTextScreen(rawComment[bodyKey], { maxLength: 2000, allowEmpty: false });
  if (!screened.allowed) return { allowed: false, reason: screened.reason, comment: rawComment };
  return { allowed: true, reason: null, comment: { ...rawComment, [bodyKey]: screened.text } };
}

module.exports = {
  cleanScreeningText,
  localTextScreen,
  screenImportedFeedPost,
  screenExternalComment,
};
