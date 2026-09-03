const test = require('node:test');
const assert = require('node:assert/strict');
const { paginateEqualizedPool } = require('./feed-pagination');

function post(id, source) {
  return { id, source };
}

const options = {
  mode: 'feed-test',
  limit: 4,
  maxPerLane: 2,
  encodeCursor: value => value,
};

test('continues every source lane without overlap or skipped posts', () => {
  const pool = [
    post('a1', 'a'), post('b1', 'b'), post('a2', 'a'), post('b2', 'b'),
    post('a3', 'a'), post('b3', 'b'), post('a4', 'a'), post('b4', 'b'),
  ];
  const first = paginateEqualizedPool(pool, options);
  const second = paginateEqualizedPool(pool, { ...options, cursorMap: first.cursorMap });

  assert.deepEqual(first.posts.map(item => item.id), ['a1', 'b1', 'a2', 'b2']);
  assert.deepEqual(second.posts.map(item => item.id), ['a3', 'b3', 'a4', 'b4']);
  assert.equal(new Set([...first.posts, ...second.posts].map(item => item.id)).size, 8);
  assert.equal(second.hasMore, false);
});

test('does not advance past an unseen row beyond the global page limit', () => {
  const pool = [post('b1', 'b'), post('a1', 'a'), post('a2', 'a')];
  const first = paginateEqualizedPool(pool, { ...options, limit: 1 });
  const second = paginateEqualizedPool(pool, { ...options, limit: 1, cursorMap: first.cursorMap });

  assert.deepEqual(first.posts.map(item => item.id), ['b1']);
  assert.deepEqual(second.posts.map(item => item.id), ['a1']);
});

test('advances through viewed rows but keeps an earlier unseen row', () => {
  const pool = [post('b1', 'b'), post('a1', 'a'), post('a2', 'a')];
  const seenIds = new Set(['a2']);
  const first = paginateEqualizedPool(pool, { ...options, limit: 1, seenIds });
  const second = paginateEqualizedPool(pool, {
    ...options,
    limit: 1,
    seenIds,
    cursorMap: first.cursorMap,
  });

  assert.deepEqual(first.posts.map(item => item.id), ['b1']);
  assert.deepEqual(second.posts.map(item => item.id), ['a1']);
  assert.equal(second.hasMore, false);
});

test('legacy page numbers resolve to the same continuation page', () => {
  const pool = [
    post('a1', 'a'), post('b1', 'b'), post('a2', 'a'), post('b2', 'b'),
    post('a3', 'a'), post('b3', 'b'), post('a4', 'a'), post('b4', 'b'),
  ];
  const first = paginateEqualizedPool(pool, options);
  const cursorSecond = paginateEqualizedPool(pool, { ...options, cursorMap: first.cursorMap });
  const numberedSecond = paginateEqualizedPool(pool, { ...options, page: 2 });

  assert.deepEqual(numberedSecond.posts, cursorSecond.posts);
});
