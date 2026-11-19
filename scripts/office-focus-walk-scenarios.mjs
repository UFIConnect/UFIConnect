import { MAX_FIX_AGE_MS } from '../office/src/focus-geofence.mjs';
import { FOCUS_STORAGE_KEY } from '../office/src/focus-studio-model.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
export function registerFocusWalkTests({ assertWalkFitsPhone, openStudio, button, fix, point, home, work, outside, dwell, clockStart, confirm, textVisible, monitorStatus, crossingNames }) {
test('a phone waits for a precise route start and saves separate segments after a pause', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  await button(page, 'Commands').click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('drop pin');
  await button(page, 'Walk a route').click();
  const walk = page.getByRole('region', { name: 'Walk a route' });
  const trackingMap = page.locator('.focus-tracking-map');
  await button(page, 'Drop start at my location').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  assert.deepEqual(await page.evaluate(() => window.focusTest.options()), {
    enableHighAccuracy: true, maximumAge: 0, timeout: 12000,
  });
  await fix(page, point(.0005, 80));
  await textVisible(walk, 'Waiting for precise GPS');
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);
  await fix(page, point(.0002, 25));
  await textVisible(walk, '0.000000° N · 0.000200° E');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Start Geo Tracking').click();
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(.0005, 80));
  await walk.getByText('Waiting for a more accurate GPS reading.', { exact: false }).waitFor();
  await page.clock.fastForward(1000);
  await fix(page, point(0, 2));
  await page.clock.fastForward(3000);
  await fix(page, point(0.0004, 2));
  await walk.getByText(/^2 points/).waitFor();
  await page.evaluate(() => window.focusTest.visibility(true));
  await walk.getByText('Walk paused while Focus Studio was out of view.').waitFor();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.evaluate(() => window.focusTest.visibility(false));
  await button(page, 'Resume walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await page.clock.fastForward(3000);
  await fix(page, point(0.003, 2));
  await page.clock.fastForward(3000);
  await fix(page, point(0.0034, 2));
  await walk.getByText(/^4 points/).waitFor();
  await button(page, 'Finish walk').click();
  const paths = await page.locator('.focus-tracking-map .focus-globe-route').getAttribute('d');
  assert.equal(paths.match(/M/g)?.length, 2);
  await page.getByLabel('Walk name', { exact: true }).fill('Morning path');
  await button(page, 'Save walk').click();
  await textVisible(page, 'Morning path saved to Trip library.');
  const [saved] = await page.evaluate(() => JSON.parse(localStorage.getItem('ufi-office-focus-trips-v1')));
  assert.equal(saved.name, 'Morning path');
  assert.equal(saved.points[0].longitude, 0);
  assert.deepEqual(saved.points.map(point => point.startsSegment), [true, false, true, false]);
  await button(page, 'Trip library').click();
  await trackingMap.getByRole('combobox', { name: /View trip/ }).selectOption(saved.id);
  await trackingMap.locator('.focus-globe-device title').filter({ hasText: 'Replay position' }).waitFor({ state: 'attached' });
});

test('a boundary gets a precise start, rejoins after GPS loss and saves an inactive geofence', async t => {
  const page = await openStudio(t, { width: 360, disableWebGL: true });
  await button(page, 'Walk a boundary').click();
  const walk = page.getByRole('region', { name: 'Walk a boundary' });
  await button(page, 'Drop start at my location').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(.0005, 80));
  await page.evaluate(() => window.focusTest.fail(2));
  const oldest = await page.evaluate(age => Date.now() - age, MAX_FIX_AGE_MS);
  await fix(page, point(.0005), { timestamp: oldest });
  await textVisible(walk, 'Waiting for precise GPS');
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);
  await fix(page, point(0));
  await textVisible(walk, '0.000000° N · 0.000000° E');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const samples = [point(0), point(.0004), { ...point(.0004), latitude: .0004 }, { ...point(0), latitude: .0004 }, point(0)];
  for (const reading of samples.slice(0, 2)) {
    await fix(page, reading);
    await page.clock.fastForward(3000);
  }
  await walk.getByText(/^2 points/).waitFor();
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await walk.getByRole('alert').filter({ hasText: 'The last location fix expired.' }).waitFor();
  await fix(page, samples[2]);
  await textVisible(walk, 'Return to the last recorded point to continue the boundary.');
  await walk.getByText(/^2 points/).waitFor();
  await page.clock.fastForward(3000);
  for (const reading of samples.slice(1)) {
    await fix(page, reading);
    await page.clock.fastForward(3000);
  }
  await button(page, 'Finish walk').click();
  await textVisible(page, '4 boundary points. Use the outline to open the zone editor.');
  assert.equal(await page.locator('.focus-globe-marker[data-marker="walk"] .focus-globe-boundary').count(), 1);
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Use as zone').click();
  await page.getByRole('heading', { name: 'New zone' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Zone shape' }).inputValue(), 'polygon');
  await button(page, 'Save zone').click();
  await textVisible(page, 'Walked zone saved.');
  const settings = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), FOCUS_STORAGE_KEY);
  assert.deepEqual(settings.zones.map(zone => [zone.name, zone.enabled]), [['Home', true], ['Walked zone', false]]);
  assert.equal(settings.zones[1].vertices.length, 4);
});

test('walk start capture times out, cancels when hidden and respects an intentionally distant map pin', async t => {
  const page = await openStudio(t, { width: 320, disableWebGL: true });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Walk a route').click();
  const walk = page.getByRole('region', { name: 'Walk a route' });
  const trackingMap = page.locator('.focus-tracking-map');
  const beginCapture = async () => {
    await button(walk, 'Drop start at my location').click();
    await page.waitForFunction(() => window.focusTest.count() === 1);
    return page.evaluate(() => window.focusTest.activeWatch());
  };

  const expired = await beginCapture();
  await fix(page, point(.0005, 80));
  await page.clock.fastForward(12000);
  await walk.getByRole('alert').filter({ hasText: 'GPS took too long.' }).waitFor();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await fix(page, point(0), { watch: expired });
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);

  const interrupted = await beginCapture();
  await page.evaluate(() => window.focusTest.visibility(true));
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.evaluate(() => window.focusTest.visibility(false));
  await fix(page, point(0), { watch: interrupted });
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);

  const replaced = await beginCapture();
  await trackingMap.getByText('Enter coordinates', { exact: true }).click();
  await trackingMap.getByLabel('Latitude', { exact: true }).fill('0');
  await trackingMap.getByLabel('Longitude', { exact: true }).fill('0.0005');
  await button(page, 'Place pin').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await fix(page, point(0), { watch: replaced });
  await textVisible(walk, '0.000000° N · 0.000500° E');
  await button(walk, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(0));
  await textVisible(walk, 'Walk to the dropped pin, or start from your GPS location.');
  assert.ok(await button(walk, 'Finish walk').isDisabled());
  await page.clock.fastForward(3000);
  await fix(page, point(.0005));
  await walk.getByText(/^1 point/).waitFor();
});

}
