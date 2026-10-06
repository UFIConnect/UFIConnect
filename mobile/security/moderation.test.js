const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const { createModerationStore, filterBlockedUsers } = require('./moderationService');

function fixture(overrides = {}) {
  const calls = [];
  const client = {
    async get(url, options) { calls.push({ method: 'GET', url, options }); return { data: { users: [] } }; },
    async post(url, body, options) { calls.push({ method: 'POST', url, body, options }); return { data: { ok: true, blocked: true } }; },
    ...overrides,
  };
  const store = createModerationStore({ client, apiBase: 'https://fixture.example.test', token: 'synthetic-session', viewerId: 'self' });
  return { client, store, calls };
}
test('report validation rejects missing session, ID, target, and reason without a request', async () => {
  const { store, calls, client } = fixture();
  const valid = { targetType: 'post', targetId: 'post-1', reason: 'spam' };
  for (const change of [{ targetId: '' }, { targetType: 'message' }, { reason: 'unknown' }]) await assert.rejects(store.report({ ...valid, ...change }));
  const loggedOut = createModerationStore({ client, apiBase: 'https://fixture.example.test', token: null });
  await assert.rejects(loggedOut.report(valid), /Sign in again/);
  assert.equal(calls.length, 0);
});
test('reports use the server contract, cap optional details, and require confirmation', async () => {
  const { store, calls } = fixture();
  await store.report({ targetType: 'user', targetId: 'user-1', reason: 'child_safety', details: ' x'.repeat(900) });
  assert.equal(calls[0].url, 'https://fixture.example.test/reports');
  assert.equal(calls[0].body.targetType, 'user');
  assert.equal(calls[0].body.reason, 'child_safety');
  assert.equal(calls[0].body.details.length, 1000);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-session');
  assert.equal(calls[0].options.timeout, 15000);
  for (const data of [{}, { ok: false }, { ok: 'true' }]) {
    const bad = fixture({ async post() { return { data }; } });
    await assert.rejects(bad.store.report({ targetType: 'post', targetId: 'p1', reason: 'other' }), /not confirmed/);
  }
});
test('blocking rejects self and missing accounts before sending a request', async () => {
  const { store, calls } = fixture();
  for (const id of ['self', '', null]) await assert.rejects(store.block(id));
  assert.equal(calls.length, 0);
});
test('blocking waits for confirmed durability and coalesces repeated presses', async () => {
  let complete, requests = 0;
  const { store } = fixture({ post() { requests++; return new Promise(resolve => { complete = resolve; }); } });
  const first = store.block('user/one'), second = store.block('user/one');
  assert.equal(first, second);
  assert.deepEqual(store.getSnapshot().blockedIds, []);
  assert.equal(requests, 1);
  complete({ data: { ok: true, blocked: true } });
  await first;
  assert.deepEqual(store.getSnapshot().blockedIds, ['user/one']);
});
test('block failures keep people visible and can be retried', async () => {
  let attempts = 0;
  const { store } = fixture({ async post() { attempts++; if (attempts === 1) throw new Error('503'); return { data: { ok: true, blocked: true } }; } });
  await assert.rejects(store.block('user-1'));
  assert.deepEqual(store.getSnapshot().blockedIds, []);
  await store.block('user-1');
  assert.deepEqual(store.getSnapshot().blockedIds, ['user-1']);
});
test('block responses must explicitly confirm ok and blocked', async () => {
  for (const data of [{}, { ok: true }, { blocked: true }, { ok: true, blocked: false }]) {
    const { store } = fixture({ async post() { return { data }; } });
    await assert.rejects(store.block('user-1'), /not confirmed/);
    assert.deepEqual(store.getSnapshot().blockedIds, []);
  }
});
test('an older blocked-list response cannot undo a completed block', async () => {
  let complete;
  const { store } = fixture({ get() { return new Promise(resolve => { complete = resolve; }); } });
  const reading = store.refresh();
  await store.block('new-block');
  complete({ data: { users: [{ id: 'existing-block' }] } });
  await reading;
  assert.deepEqual(store.getSnapshot().blockedIds.sort(), ['existing-block', 'new-block']);
  assert.equal(store.getSnapshot().loaded, true);
});
test('a late earlier refresh cannot overwrite a newer blocked list', async () => {
  const completions = [];
  const { store } = fixture({ get() { return new Promise(resolve => completions.push(resolve)); } });
  const older = store.refresh(), newer = store.refresh();
  completions[1]({ data: { users: [{ id: 'newer' }] } }); await newer;
  completions[0]({ data: { users: [] } }); await older;
  assert.deepEqual(store.getSnapshot().blockedIds, ['newer']);
});
test('blocked-list failure is visible and does not masquerade as an empty successful list', async () => {
  const { store } = fixture({ async get() { throw new Error('Offline'); } });
  await store.refresh();
  assert.equal(store.getSnapshot().loaded, false);
  assert.equal(store.getSnapshot().loading, false);
  assert.match(store.getSnapshot().error, /Could not load/);
});
test('blocked state is session-scoped and subscriptions observe confirmed changes', async () => {
  const first = fixture(), second = fixture();
  let notifications = 0;
  const unsubscribe = first.store.subscribe(() => notifications++);
  await first.store.block('member');
  assert.equal(notifications, 1);
  assert.deepEqual(second.store.getSnapshot().blockedIds, []);
  unsubscribe(); first.store.dispose();
  await assert.rejects(first.store.block('another'), /Sign in again/);
});
test('one filtering rule hides blocked feed authors, members, and conversations', () => {
  assert.deepEqual(filterBlockedUsers([{ author: { id: 'blocked' } }, { author: { id: 'keep' } }], ['blocked'], post => post.author?.id), [{ author: { id: 'keep' } }]);
  assert.deepEqual(filterBlockedUsers([{ id: 'blocked' }, { id: 'keep' }], ['blocked'], member => member.id), [{ id: 'keep' }]);
  assert.deepEqual(filterBlockedUsers([{ participant: { id: 'blocked' } }], ['blocked'], conversation => conversation.participant?.id), []);
});

function dialogFixture(props = {}) {
  const filename = path.resolve(__dirname, '../components/SafetyDialog.js');
  const code = require('@babel/core').transformFileSync(filename, { babelrc: false, configFile: false, plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  const states = [], refs = [];
  let index = 0, refIndex = 0;
  const react = {
    createElement(type, values, ...children) { return { type, props: values || {}, children: children.flat().filter(value => value !== null && value !== false) }; },
    useState(initial) { const position = index++; if (!(position in states)) states[position] = initial; return [states[position], value => { states[position] = value; }]; },
    useRef(initial) { const position = refIndex++; if (!refs[position]) refs[position] = { current: initial }; return refs[position]; },
  };
  const native = { StyleSheet: { create: value => value }, Platform: { OS: 'ios' } };
  for (const name of ['Modal', 'View', 'Text', 'ScrollView', 'TextInput', 'TouchableOpacity', 'ActivityIndicator', 'KeyboardAvoidingView']) native[name] = name;
  const sandbox = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === '../theme') return { COLORS: {} };
    if (name === '../security/moderationService') return require('./moderationService');
    throw new Error(`Unexpected import ${name}`);
  } };
  vm.runInNewContext(code, sandbox, { filename });
  function all(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(all)] : []; }
  function render() { index = 0; refIndex = 0; return all(sandbox.exports.default({ target: { postId: 'p1', userId: 'u1', userName: 'Fixture Person' }, onClose() {}, onReport: async () => {}, onBlock: async () => {}, ...props })); }
  return { render, button(label) { return render().find(node => node.props.accessibilityLabel === label); } };
}
test('native dialog requires block confirmation, locks pending controls, and acknowledges success', async () => {
  let resolve, calls = 0, closed = 0;
  const fixture = dialogFixture({ onBlock() { calls++; return new Promise(done => { resolve = done; }); }, onClose() { closed++; } });
  fixture.button('Block user').props.onPress();
  assert.equal(calls, 0);
  const pending = fixture.button('Confirm block').props.onPress();
  assert.equal(calls, 1);
  assert.equal(fixture.button('Confirm block').props.disabled, true);
  assert.equal(fixture.button('Cancel').props.disabled, true);
  fixture.render().find(node => node.type === 'Modal').props.onRequestClose();
  assert.equal(closed, 0);
  resolve(); await pending;
  assert.ok(fixture.render().some(node => node.props.accessibilityRole === 'alert' && node.children.some(value => String(value).startsWith('User blocked.'))));
  fixture.button('Done').props.onPress();
  assert.equal(closed, 1);
});
test('native reporting requires a reason and preserves the form after failure', async () => {
  let payload;
  const fixture = dialogFixture({ async onReport(value) { payload = value; throw new Error('503'); } });
  fixture.button('Report post').props.onPress();
  assert.equal(fixture.button('Submit report').props.disabled, true);
  fixture.button('Harassment or bullying').props.onPress();
  fixture.button('Report details').props.onChangeText('Fictional report details');
  await fixture.button('Submit report').props.onPress();
  assert.equal(payload.targetType, 'post'); assert.equal(payload.targetId, 'p1');
  assert.equal(payload.reason, 'harassment'); assert.equal(payload.details, 'Fictional report details');
  assert.equal(fixture.button('Report details').props.value, 'Fictional report details');
  assert.equal(fixture.button('Submit report').props.disabled, false);
  assert.ok(fixture.render().some(node => node.props.accessibilityRole === 'alert' && node.children.includes('Could not submit your report. Please try again.')));
});
