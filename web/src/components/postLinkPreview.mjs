import { safePostLink } from '../../../backend/post-links.mjs';
import { postTextParts } from '../../../backend/post-text.mjs';

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u;

function readable(value) {
  try {
    const decoded = decodeURI(value);
    return UNSAFE_DISPLAY.test(decoded) ? value : decoded;
  } catch { return value; }
}

function shorten(value, length) {
  const points = Array.from(value);
  return points.length > length ? `${points.slice(0, length - 1).join('')}…` : value;
}

// Show the actual ASCII hostname (including punycode), never a page title
// guessed from the surrounding post. The href and accessible label keep the
// complete destination, including parameters omitted from the compact label.
export function postLinkDestination(value) {
  const href = safePostLink(value);
  if (!href || UNSAFE_DISPLAY.test(value)) return null;
  const url = new URL(href);
  const query = new URLSearchParams();
  for (const [key, entry] of url.searchParams) {
    if (!TRACKING_PARAMETER.test(key)) query.append(key, entry);
  }
  const search = query.toString();
  const path = `${readable(url.pathname)}${search ? `?${readable(search)}` : ''}${readable(url.hash)}`;
  return {
    href,
    domain: url.host,
    path: shorten(path, 180),
    label: `${url.host}${path === '/' ? '' : shorten(path, 78)}`,
  };
}

export function postLinkPreviews(text, excludeUrl) {
  const seen = new Set([safePostLink(excludeUrl)].filter(Boolean));
  const links = [];
  for (const part of postTextParts(text)) {
    if (!part.href || seen.has(part.href)) continue;
    const destination = postLinkDestination(part.href);
    if (!destination) continue;
    seen.add(destination.href);
    links.push(destination);
  }
  return links;
}
