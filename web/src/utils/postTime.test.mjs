import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPostAge, narrowPostAge, postTimes, timeAgo } from './postTime.mjs';

process.env.TZ = 'America/Los_Angeles';
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, WEEK = 7 * DAY;
const now = Date.parse('2026-10-18T19:00:00Z');
const options = { now, locale: 'en-US' };
const before = age => new Date(now - age).toISOString();

test('post ages show minutes and hours, then unbounded days', () => {
  for (const [age, expected] of [[0, 'Just now'], [MINUTE - 1, 'Just now'], [MINUTE, '1 minute ago'],
    [HOUR - 1, '59 minutes ago'], [HOUR, '1 hour ago'], [DAY - 1, '23 hours ago'],
    [DAY, '1 day ago'], [2 * DAY, '2 days ago'], [WEEK - 1, '6 days ago'], [WEEK, '7 days ago'],
    [WEEK + 1, '7 days ago'], [8 * DAY, '8 days ago'], [30 * DAY, '30 days ago'], [365 * DAY, '365 days ago']]) {
    assert.equal(formatPostAge(before(age), options), expected, String(age));
  }
});

test('compact comments, messages, and notifications also retain older day counts', () => {
  assert.equal(timeAgo(before(HOUR), options), '1h ago');
  assert.equal(timeAgo(before(DAY), options), '1d ago');
  assert.equal(timeAgo(before(WEEK), options), '7d ago');
  assert.equal(narrowPostAge(before(0), options), 'Now');
  assert.equal(narrowPostAge(before(3 * DAY), options), '3d');
  assert.equal(timeAgo(before(8 * DAY), options), '8d ago');
  assert.equal(narrowPostAge(before(30 * DAY), options), '30d');
  assert.equal(timeAgo(before(365 * DAY), options), '365d ago');
});

test('exact dates remain local and include the year in timestamp details', () => {
  const recent = postTimes({ createdAt: '2026-10-01T01:00:00Z' }, options);
  assert.equal(recent.day, 'Sep 30');
  assert.match(recent.full, /September 30, 2026/);
  assert.equal(recent.iso, '2026-10-01T01:00:00.000Z');
  const priorYear = postTimes({ createdAt: '2025-12-30T01:00:00Z' }, options);
  assert.equal(priorYear.day, 'Dec 29, 2025');
  assert.match(priorYear.full, /December 29, 2025/);
  assert.equal(postTimes({ createdAt: '2026-10-01T01:00:00Z' }, { ...options, locale: 'en-GB' }).day, '30 Sept');
});

test('day boundaries use elapsed time across daylight saving changes', () => {
  const autumn = Date.parse('2026-11-02T08:30:00Z');
  assert.equal(formatPostAge(autumn - DAY + 1, { now: autumn }), '23 hours ago');
  assert.equal(formatPostAge(autumn - DAY, { now: autumn }), '1 day ago');
  const spring = Date.parse('2026-03-09T07:30:00Z');
  assert.equal(formatPostAge(spring - DAY, { now: spring }), '1 day ago');
});

test('missing and invalid timestamps stay blank and future timestamps never show negative ages', () => {
  for (const value of [undefined, null, '', 'not-a-date', NaN, Infinity, 0]) {
    assert.equal(formatPostAge(value, options), '');
    assert.equal(timeAgo(value, options), '');
    assert.equal(postTimes({ createdAt: value }, options), null);
  }
  assert.equal(formatPostAge(now + DAY, options), 'Just now');
  assert.equal(narrowPostAge(now + DAY, options), 'Now');
});

test('source edits retain exact timestamps and update the displayed age without changing creation time', () => {
  const post = { createdAt: before(20 * DAY), editedAt: before(2 * HOUR) };
  const result = postTimes(post, options);
  assert.equal(result.relative, '2 hours ago');
  assert.equal(result.edited, true);
  assert.equal(result.iso, post.editedAt);
  assert.match(result.full, /^Edited Sunday, October 18, 2026 at 10:00:00 AM PDT$/);
  assert.equal(post.createdAt, before(20 * DAY));
  const old = postTimes({ time: before(20 * DAY) }, options);
  assert.equal(old.relative, '20 days ago');
  assert.match(old.full, /^Posted /);
  assert.equal(old.iso, before(20 * DAY));
});

test('the existing one-minute edit threshold remains strict', () => {
  const createdAt = before(2 * DAY);
  assert.equal(postTimes({ createdAt, editedAt: new Date(Date.parse(createdAt) + MINUTE).toISOString() }, options).edited, false);
  assert.equal(postTimes({ createdAt, editedAt: new Date(Date.parse(createdAt) + MINUTE + 1).toISOString() }, options).edited, true);
});
