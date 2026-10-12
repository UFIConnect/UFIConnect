import assert from 'node:assert/strict';
import test from 'node:test';
import { availableFeedPage, feedPagePosts, nextFeedPage } from './feedPagination.mjs';

const posts = (start, count) => Array.from({ length: count }, (_, index) => ({ id: `post-${start + index}`, content: `Post ${start + index}` }));
const context = (items, pages, overrides = {}) => ({ pages, getPosts: () => items, canLoad: () => false,
  loadMore: async () => { throw new Error('Unexpected network request'); }, isCurrent: () => true, ...overrides });

test('display pages contain at most 12 unique posts and cached Next needs no request', async () => {
  const items = [...posts(1, 30), ...posts(1, 5)];
  const first = availableFeedPage(items);
  assert.equal(first.length, 12);
  const next = await nextFeedPage(context(items, [first]));
  assert.equal(next.page, 2);
  assert.deepEqual(next.pages[1], posts(13, 12).map(post => post.id));
  assert.equal(new Set(next.pages.flat()).size, 24);
});

test('Previous preserves membership and order after reordered data or newer arrivals', () => {
  const first = availableFeedPage(posts(1, 12));
  const changed = [...posts(100, 12), ...posts(1, 12).reverse()].map(post => ({ ...post, likesCount: 4 }));
  assert.deepEqual(feedPagePosts(changed, first).map(post => post.id), first);
  assert.equal(feedPagePosts(changed, first)[0].likesCount, 4);
  assert.deepEqual(feedPagePosts(changed.filter(post => post.id !== 'post-3'), first).map(post => post.id), first.filter(id => id !== 'post-3'));
});

test('a partial page stays stable and the following page does not skip newly fetched posts', async () => {
  let items = posts(1, 15);
  const first = availableFeedPage(items);
  const partial = await nextFeedPage(context(items, [first]));
  assert.equal(partial.pages[1].length, 3);
  items = [...items, ...posts(16, 12)];
  const third = await nextFeedPage(context(items, partial.pages));
  assert.deepEqual(third.pages[1], partial.pages[1]);
  assert.deepEqual(third.pages[2], posts(16, 12).map(post => post.id));
});

test('one Next crosses at most three filtered batches and never invents another page', async () => {
  let calls = 0;
  const items = posts(1, 12), pages = [availableFeedPage(items)];
  const result = await nextFeedPage(context(items, pages, { canLoad: () => true, loadMore: async () => { calls++; return { exhausted: false }; } }));
  assert.equal(calls, 3);
  assert.deepEqual(result, { pages, page: 1, empty: true });
});

test('an empty first result is filled as page one by an explicit Next', async () => {
  let items = [], calls = 0;
  const result = await nextFeedPage(context(items, [[]], { getPosts: () => items, canLoad: () => true,
    loadMore: async () => { calls++; items = posts(1, 5); return { exhausted: true }; } }));
  assert.equal(result.page, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].length, 5);
  assert.equal(calls, 1);
});

test('an exhausted empty response leaves the populated current page in place', async () => {
  const items = posts(1, 12), pages = [availableFeedPage(items)];
  const result = await nextFeedPage(context(items, pages, { canLoad: () => true, loadMore: async () => ({ exhausted: true }) }));
  assert.deepEqual(result, { pages, page: 1, empty: true });
});

test('failed partial requests preserve visited pages and retry includes all fetched cards once', async () => {
  let items = posts(1, 12), calls = 0;
  const pages = [availableFeedPage(items)], original = structuredClone(pages);
  const options = context(items, pages, { getPosts: () => items, canLoad: () => true, loadMore: async () => {
    calls++;
    if (calls === 1) { items = [...items, ...posts(13, 4)]; return { exhausted: false }; }
    if (calls === 2) return { error: 'Please retry' };
    items = [...items, ...posts(17, 8)]; return { exhausted: true };
  } });
  await assert.rejects(nextFeedPage(options), /Please retry/);
  assert.deepEqual(pages, original);
  const retry = await nextFeedPage(options);
  assert.deepEqual(retry.pages[1], posts(13, 12).map(post => post.id));
  assert.equal(calls, 3);
});

test('query or account changes invalidate an in-flight Next before its result commits', async () => {
  const items = posts(1, 12), pages = [availableFeedPage(items)];
  let active = true, calls = 0;
  const result = await nextFeedPage(context(items, pages, { canLoad: () => true, isCurrent: () => active,
    loadMore: async () => { calls++; active = false; return { exhausted: false }; } }));
  assert.equal(result, null);
  assert.equal(calls, 1);
  const reset = availableFeedPage(posts(100, 20));
  assert.deepEqual(reset, posts(100, 12).map(post => post.id));
});

test('a stale transport response is discarded even before the next render updates context', async () => {
  const items = posts(1, 12);
  assert.equal(await nextFeedPage(context(items, [availableFeedPage(items)], { canLoad: () => true,
    loadMore: async () => ({ stale: true }) })), null);
});
