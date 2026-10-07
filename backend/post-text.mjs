import { safePostLink } from './post-links.mjs';

// Text stays text. Only complete HTTP(S) URLs become links; trailing prose
// punctuation and unbalanced closing brackets remain outside the anchor.
export function postTextParts(value) {
  const text = String(value || '');
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const start = match.index;
    let label = match[0].replace(/[.,;:!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
    }
    label = label.replace(/[.,;:!?]+$/, '');
    const shortened = /\u2026|\.\.\.(?:[)\]}.,;:!?]*)$/u.test(match[0]);
    const href = !shortened && !/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(label) ? safePostLink(label) : null;
    if (!href) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), start: cursor });
    parts.push({ text: label, href, start });
    cursor = start + label.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), start: cursor });
  return parts;
}

// Cutting a URL halfway can silently send the reader to a different page.
// Omit that URL from a preview; expanding reveals the complete destination.
export function postTextPreview(value, limit) {
  const text = String(value || '');
  if (!Number.isFinite(limit) || text.length <= limit) return text;
  let end = Math.max(0, Math.floor(limit));
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    if (match.index < end && match.index + match[0].length > end) {
      end = match.index;
      break;
    }
  }
  // Avoid splitting surrogate pairs (for example, an emoji).
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return text.slice(0, end).trimEnd();
}
