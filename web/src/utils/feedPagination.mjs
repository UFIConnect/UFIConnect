export const FEED_DISPLAY_PAGE_SIZE = 12;

export function feedPageKey(post) {
  return post?.id ? String(post.id) : `${post?.source || 'feed'}:${post?.sourceUrl || post?.title || post?.content || ''}:${post?.createdAt || ''}`;
}

export function availableFeedPage(posts, pages = [], limit = FEED_DISPLAY_PAGE_SIZE) {
  const used = new Set(pages.flat());
  const selected = [];
  for (const post of posts) {
    const key = feedPageKey(post);
    if (used.has(key)) continue;
    used.add(key); selected.push(key);
    if (selected.length === limit) break;
  }
  return selected;
}

export function feedPagePosts(posts, keys = []) {
  const current = new Map(posts.map(post => [feedPageKey(post), post]));
  return keys.map(key => current.get(key)).filter(Boolean);
}

// One deliberate Next action may cross a few filtered server batches. Page
// membership is committed once, so partial pages and later sort changes cannot
// skip cards or change what Previous shows. No totals are inferred from caches.
export async function nextFeedPage({ pages, getPosts, canLoad, loadMore, isCurrent, maxRequests = 3 }) {
  const emptyFirstPage = pages.length === 1 && pages[0].length === 0;
  const previous = emptyFirstPage ? [] : pages;
  let selected = availableFeedPage(getPosts(), previous);
  let requests = 0;
  while (selected.length < FEED_DISPLAY_PAGE_SIZE && canLoad() && requests < maxRequests) {
    if (!isCurrent()) return null;
    const result = await loadMore();
    if (!isCurrent() || result?.stale) return null;
    if (result?.error) throw new Error(result.error);
    if (!result || result.skipped) break;
    requests += 1;
    selected = availableFeedPage(getPosts(), previous);
    if (result.exhausted) break;
  }
  if (!isCurrent()) return null;
  if (!selected.length) return { pages, page: pages.length || 1, empty: true };
  const next = [...previous, selected];
  return { pages: next, page: next.length, empty: false };
}
