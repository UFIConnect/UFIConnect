const { safePostLink } = require('./post-links.mjs');
const { SOURCE_CONTENT_MAX_CHARS, boundedSourceText } = require('./source-post-content');

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®' };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? entity;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

function plainText(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/gi, '\n\n').replace(/<\/?[a-zA-Z][^<>]*>/g, ''));
}

// Mastodon renders links using nested spans, including visually shortened
// URLs. Keep the actual destination before removing markup. The result is
// plain text throughout the storage pipeline and is escaped by React.
function mastodonContentText(value, maxChars = SOURCE_CONTENT_MAX_CHARS) {
  const html = String(value || '').slice(0, 1_000_000)
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|iframe|template)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const withLinks = html.replace(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([^]*?)<\/a\s*>/gi, (_, attributes, inner) => {
    const match = attributes.match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const href = match ? safePostLink(decodeEntities(match[1] ?? match[2] ?? match[3])) : null;
    const label = plainText(inner).trim();
    if (!href) return inner;
    const visibleUrl = label.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const fullUrl = href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const text = !label || visibleUrl === fullUrl || /class\s*=\s*["'][^"']*\b(?:invisible|ellipsis)\b/i.test(inner)
      ? href : `${label} (${href})`;
    // Escape once for the final HTML-to-text pass, so encoded '<' in a link
    // label is not mistaken for another markup element.
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
  const text = plainText(withLinks).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return boundedSourceText(text, maxChars);
}

module.exports = { mastodonContentText };
