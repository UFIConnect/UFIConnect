'use strict';

// This module intentionally contains only deterministic, cheap checks. It is
// used on every external-feed item, so it must stay safe to call in a hot path.
const INVISIBLE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const UNSAFE_URL_SCHEME = /^\s*(?:javascript|vbscript|data|file):/i;
const REPEATED_CHARACTER = /(.)\1{17,}/u;
const REPEATED_WORD = /\b([\p{L}\p{N}][\p{L}\p{N}'-]{1,})\b(?:\s+\1\b){7,}/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>]+/gi;
const PLACEHOLDER_ONLY = /^(?:n\/?a|none|no (?:title|content)|untitled|test(?: post)?|placeholder|coming soon|click here|read more|link)(?:[.!?]+)?$/i;
const IMPORTED_POST_FUTURE_SKEW_MS = 15 * 60 * 1000;

const SCAM_PATTERNS = [
  /\b(?:guaranteed|risk[- ]?free)\b.{0,72}\b(?:profit|return|income)\b/i,
  /\b(?:send|deposit)\b.{0,72}\b(?:bitcoin|crypto|usdt|ethereum)\b/i,
  /\b(?:dm|message|contact)\s+(?:me|us)\b.{0,96}\b(?:whatsapp|telegram)\b/i,
  /\b(?:buy|buying|purchase|purchasing|sell|selling|rent|renting)\b.{0,120}\baccounts?\b/i,
  /\baccounts?\b.{0,120}\b(?:for sale|seller|buy|buying|purchase|purchasing|rent|renting)\b/i,
  /\b(?:buy|purchase|rent)\b.{0,96}\b(?:verified|aged|stealth)\b.{0,64}\baccounts?\b/i,
  /\b(?:verified|aged|stealth)\b.{0,64}\baccounts?\b.{0,96}\b(?:for sale|seller|buy|purchase)\b/i,
  /\b(?:buy|purchase)\b.{0,96}\b(?:bank|wise|paypal|cash\s*app|stripe|social media)\b.{0,64}\baccounts?\b/i,
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

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function importedPostTimestamp(rawPost) {
  const value = rawPost?.createdAt ?? rawPost?.publishedAt ?? rawPost?.posted ?? rawPost?.time;
  if (value === null || value === undefined || value === '') return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : NaN;
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
  const readableText = `${title.text} ${content.text}`.trim();
  if (PLACEHOLDER_ONLY.test(readableText)) {
    return { allowed: false, reason: 'placeholder_content', post: rawPost };
  }
  if ([rawPost.sourceUrl, rawPost.mediaUrl, rawPost.mediaPoster].some(hasUnsafeUrl)) {
    return { allowed: false, reason: 'unsafe_url', post: rawPost };
  }

  // Imported posts remain attributable to the publisher that supplied them.
  // This verifies provenance, not the truth of the publisher's claims; those
  // claims are preserved verbatim and the original link stays available.
  const source = String(rawPost.source || '').trim().toLowerCase();
  const isExternal = rawPost.isExternal !== false && source !== 'uficonnect';
  if (isExternal && !isHttpUrl(rawPost.sourceUrl)) {
    return { allowed: false, reason: rawPost.sourceUrl ? 'invalid_source_url' : 'missing_source_url', post: rawPost };
  }
  for (const mediaUrl of [rawPost.mediaUrl, rawPost.mediaPoster]) {
    if (mediaUrl && !isHttpUrl(mediaUrl)) {
      return { allowed: false, reason: 'invalid_media_url', post: rawPost };
    }
  }

  const timestamp = importedPostTimestamp(rawPost);
  if (Number.isNaN(timestamp)) return { allowed: false, reason: 'invalid_timestamp', post: rawPost };
  if (timestamp && timestamp > Date.now() + IMPORTED_POST_FUTURE_SKEW_MS) {
    return { allowed: false, reason: 'future_timestamp', post: rawPost };
  }

  const textWithoutLinks = readableText.replace(URL_PATTERN, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!textWithoutLinks && !rawPost.mediaUrl) {
    return { allowed: false, reason: 'link_only_content', post: rawPost };
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
    sourceLinked: isExternal ? true : Boolean(rawPost.sourceUrl),
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
