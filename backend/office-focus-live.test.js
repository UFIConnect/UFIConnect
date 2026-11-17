const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness } = require('./test-support/app-harness');

const path = '/office/focus/live';
const token = 'synthetic-office-live';
const headers = { 'x-office-token': token };
const point = { latitude: 37, longitude: -122, accuracy: 4, age: 0, speed: 13, heading: 89 };

test('Office live GPS requires Office access and a separate publisher credential', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: token } });
  t.after(() => app.close());
  assert.equal((await app.request(path)).status, 401);
  const unauthorized = await app.request(path, { method: 'POST', body: { name: 'Van', kind: 'vehicle', type: 'van' } });
  assert.equal(unauthorized.status, 401);
  assert.equal((await app.request(path, { method: 'POST', headers, body: { name: 'x'.repeat(1500), kind: 'phone' } })).status, 413);
  const created = await app.request(path, { method: 'POST', headers, body: {
    name: 'Van', kind: 'vehicle', type: 'van', phone: '+15550100000',
  } });
  assert.equal(created.status, 201);
  const { id, publisher } = created.data;
  const update = (body, extra = {}) => app.request(`${path}/${id}`, {
    method: 'PUT', headers: { ...headers, ...extra }, body,
  });
  assert.equal((await update(point)).status, 404);
  const key = { 'x-focus-publisher': publisher };
  assert.equal((await update({ ...point, latitude: 91 }, key)).status, 400);
  assert.equal((await update({ ...point, age: 25_000 }, key)).status, 400);
  assert.equal((await update(point, key)).status, 204);
  const snapshot = await app.request(path, { headers });
  assert.equal(snapshot.headers.get('cache-control'), 'no-store');
  const { sources } = snapshot.data;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, 'van');
  assert.equal(sources[0].fix.longitude, -122);
  assert.equal(sources[0].fix.speed, 13);
  assert.equal(sources[0].phone, undefined);
  assert.equal(sources[0].publisher, undefined);
  assert.equal((await app.request(`${path}/${id}`, { method: 'DELETE', headers })).status, 404);
  assert.equal((await app.request(`${path}/${id}`, { method: 'DELETE', headers: { ...headers, ...key } })).status, 204);
  assert.equal((await update(point, key)).status, 404, 'a late write cannot restart sharing');
  assert.deepEqual((await app.request(path, { headers })).data, { sources: [] });
});

test('Office live devices disappear when their GPS fix expires', async t => {
  let time = 1_000_000;
  const { registerOfficeFocusLive } = require('./office-focus-live');
  const app = await createAppHarness({ env: { OFFICE_TOKEN: token }, modules: {
    './office-focus-live': { registerOfficeFocusLive: (app, options) => registerOfficeFocusLive(app, { ...options, now: () => time }) },
  } });
  t.after(() => app.close());
  const enrollment = await app.request(path, { method: 'POST', headers, body: { name: 'Bike', kind: 'bicycle' } });
  const { id, publisher } = enrollment.data;
  const publish = () => app.request(`${path}/${id}`, { method: 'PUT', headers: { ...headers, 'x-focus-publisher': publisher },
    body: point });
  assert.equal((await publish()).status, 204);
  time += 25_000;
  assert.deepEqual((await app.request(path, { headers })).data, { sources: [] });
  assert.equal((await publish()).status, 204, 'a fresh fix restores a still-active session');
  time += 90_000;
  assert.equal((await publish()).status, 404, 'a timed-out session requires renewed sharing');
});
