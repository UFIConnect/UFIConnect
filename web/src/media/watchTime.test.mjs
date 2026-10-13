import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchClock, playbackMeasurementAllowed, mediaHistoryKey, MAX_SAMPLE_GAP_MS } from './watchTime.mjs';

const point = (now, position, extra = {}) => ({ now, position, playing: true, ...extra });

test('watch clock requires two advancing samples and counts elapsed playback time', () => {
  const clock = createWatchClock();
  assert.equal(clock.sample(point(100, 12)), 0);
  assert.equal(clock.sample(point(600, 12.5)), 500);
  assert.equal(clock.sample(point(1100, 13)), 500);
  assert.equal(clock.watchedMs, 1000);
});

test('paused, hidden or disabled, seeking and malformed samples break the measured interval', () => {
  const invalid = [ { playing: false }, { enabled: false }, { seeking: true }, { position: NaN },
    { position: Infinity }, { position: -1 }, { rate: 0 }, { rate: -1 }, { rate: Infinity }, { rate: 17 }, { now: NaN } ];
  for (const extra of invalid) {
    const clock = createWatchClock();
    clock.sample(point(0, 0));
    assert.equal(clock.sample(point(500, .5, extra)), 0, JSON.stringify(extra));
    assert.equal(clock.sample(point(1000, 1)), 0, 'Resumption anchors instead of charging the excluded interval');
    assert.equal(clock.sample(point(1500, 1.5)), 500);
    assert.equal(clock.watchedMs, 500);
  }
});

test('stalled positions and polling ticks produce no watch time', () => {
  const clock = createWatchClock();
  clock.sample(point(0, 0));
  for (let now = 250; now <= 2000; now += 250) assert.equal(clock.sample(point(now, 0)), 0);
  assert.equal(clock.watchedMs, 0);
  assert.equal(clock.sample(point(2250, .25)), 0, 'A long stall resets the anchor');
  assert.equal(clock.sample(point(2500, .5)), 250, 'Only subsequently advancing playback counts');
});

test('a partially stalled interval is bounded by real media progress', () => {
  const clock = createWatchClock();
  clock.sample(point(0, 0));
  clock.sample(point(500, 0));
  assert.equal(clock.sample(point(1000, .25)), 250);
  assert.equal(clock.watchedMs, 250);
});

test('forward and backward seeks never add skipped media to measured time', () => {
  const clock = createWatchClock();
  clock.sample(point(0, 0));
  assert.equal(clock.sample(point(250, 30)), 0);
  assert.equal(clock.sample(point(500, 30.25)), 250);
  assert.equal(clock.sample(point(750, 10)), 0);
  assert.equal(clock.sample(point(1000, 10.25)), 250);
  assert.equal(clock.watchedMs, 500);
});

test('throttled or backwards wall clocks cannot count suspended time', () => {
  const clock = createWatchClock();
  clock.sample(point(1000, 0));
  assert.equal(clock.sample(point(1000, .1)), 0, 'Repeated wall timestamp');
  assert.equal(clock.sample(point(900, .2)), 0, 'Backwards wall timestamp');
  assert.equal(clock.sample(point(900 + MAX_SAMPLE_GAP_MS + 1, 10)), 0, 'Long timer gap');
  assert.equal(clock.sample(point(1150 + MAX_SAMPLE_GAP_MS + 1, 10.25)), 250);
  assert.equal(clock.watchedMs, 250);
});

test('playback rate does not multiply elapsed watch time', () => {
  for (const rate of [.25, .5, 1, 1.5, 2, 4, 16]) {
    const clock = createWatchClock();
    clock.sample(point(0, 0, { rate }));
    assert.equal(clock.sample(point(1000, rate, { rate })), 1000, `At ${rate}x, one wall second is one measured second`);
    assert.equal(clock.watchedMs, 1000);
  }
});

test('rate changes and explicit reset start a fresh interval without erasing measured totals', () => {
  const clock = createWatchClock();
  clock.sample(point(0, 0));
  clock.sample(point(500, .5));
  assert.equal(clock.sample(point(1000, 1, { rate: 2 })), 0);
  assert.equal(clock.sample(point(1500, 2, { rate: 2 })), 500);
  clock.reset();
  assert.equal(clock.sample(point(5000, 40)), 0);
  assert.equal(clock.sample(point(5500, 40.5)), 500);
  assert.equal(clock.watchedMs, 1500);
});

test('YouTube measurement requires explicit permission and confirmed non-kids classification', () => {
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'youtube' }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'youtube', trackingAllowed: true }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'youtube', trackingAllowed: true, privacyClassification: 'made_for_kids' }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'youtube', trackingAllowed: false, privacyClassification: 'not_made_for_kids' }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'youtube', trackingAllowed: true, privacyClassification: 'not_made_for_kids' }), true);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'native', trackingAllowed: false }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'vimeo', privacyClassification: 'made_for_kids' }), false);
  assert.equal(playbackMeasurementAllowed({ playbackSource: 'uficonnect' }), true);
  assert.equal(playbackMeasurementAllowed({}), false);
});

test('history grouping keys are deterministic and never embed raw identifiers or signed URLs', () => {
  const signed = 'https://media.example.invalid/private.mp4?token=private-secret&signature=fixture';
  assert.match(mediaHistoryKey(signed), /^[a-f0-9]{16}$/);
  assert.equal(mediaHistoryKey(signed), mediaHistoryKey(signed));
  assert.notEqual(mediaHistoryKey(signed), mediaHistoryKey(signed + '-different'));
  assert.equal(mediaHistoryKey(signed).includes('private-secret'), false);
});
