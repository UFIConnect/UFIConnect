const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const { deleteAccountWithSession } = require('./accountDeletion');

function serviceFixture({ data = { deleted: true }, failure, storageFailure = false } = {}) {
  const calls = [];
  let signedIn = true;
  const client = {
    async delete(url, options) {
      calls.push({ kind: 'request', url, options });
      if (failure) throw failure;
      return { data };
    },
  };
  const options = {
    client, apiBase: 'https://api.example.test', token: 'synthetic-test-session',
    async clearLocalSession() {
      calls.push({ kind: 'clear' });
      signedIn = false;
      if (storageFailure) throw new Error('Keychain unavailable');
    },
  };
  return { calls, options, signedIn: () => signedIn };
}

test('deletion requires a session before making any API request', async () => {
  for (const token of [null, undefined, '', 123]) {
    const fixture = serviceFixture();
    await assert.rejects(deleteAccountWithSession({ ...fixture.options, token }), /Sign in again/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.signedIn(), true);
  }
});

test('confirmed deletion uses the authenticated self-delete endpoint, then clears the device session', async () => {
  const fixture = serviceFixture();
  assert.deepEqual(await deleteAccountWithSession(fixture.options), { deleted: true, localCleared: true });
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.calls[0], {
    kind: 'request', url: 'https://api.example.test/profile',
    options: { headers: { Authorization: 'Bearer synthetic-test-session' }, timeout: 15000 },
  });
  assert.equal(fixture.calls[1].kind, 'clear');
  assert.equal(fixture.signedIn(), false);
});

test('a success status without deleted:true keeps the account session and reports uncertainty', async () => {
  for (const data of [undefined, {}, { deleted: false }, { deleted: 'true' }]) {
    const fixture = serviceFixture({ data });
    // An explicit undefined body must not receive the fixture's default.
    if (data === undefined) fixture.options.client.delete = async () => ({ data });
    await assert.rejects(deleteAccountWithSession(fixture.options), /did not confirm/);
    assert.equal(fixture.calls.some(call => call.kind === 'clear'), false);
    assert.equal(fixture.signedIn(), true);
  }
});

test('network and backend failures do not clear local sign-in or retry deletion', async () => {
  for (const failure of [new Error('Network unavailable'), { response: { status: 500 } }, { code: 'ECONNABORTED' }]) {
    const fixture = serviceFixture({ failure });
    await assert.rejects(deleteAccountWithSession(fixture.options));
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.signedIn(), true);
  }
});

test('a keychain cleanup failure preserves confirmed deletion without repeating the request', async () => {
  const fixture = serviceFixture({ storageFailure: true });
  assert.deepEqual(await deleteAccountWithSession(fixture.options), { deleted: true, localCleared: false });
  assert.equal(fixture.calls.filter(call => call.kind === 'request').length, 1);
  assert.equal(fixture.signedIn(), false);
});

function componentFixture(deleteAccount = async () => ({ deleted: true, localCleared: true })) {
  const filename = path.resolve(__dirname, '../components/AccountDeletionCard.js');
  const transformed = require('@babel/core').transformFileSync(filename, {
    babelrc: false, configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const hooks = [];
  const effects = [];
  const listeners = {};
  const alerts = [];
  let hookIndex = 0;
  let firstRender = true;
  let requests = 0;
  const react = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat().filter(value => value !== false && value != null) }; },
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(value) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: value };
      return hooks[index];
    },
    useEffect(effect) { if (firstRender) effects.push(effect); },
  };
  const native = {
    ...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Modal','ScrollView','Text','TextInput','TouchableOpacity','View'].map(name => [name, name])),
    Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
    Alert: { alert: (...args) => alerts.push(args) },
    AppState: { addEventListener: (event, listener) => { listeners.background = listener; return { remove() {} }; } },
  };
  const sandbox = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === '../context/AuthContext') return { useAuth: () => ({ deleteAccount: async () => { requests++; return deleteAccount(); } }) };
    if (name === '../theme') return { COLORS: {} };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(transformed, sandbox, { filename });
  const navigation = { addListener(event, listener) { listeners[event] = listener; return () => {}; } };
  function render() {
    hookIndex = 0;
    const tree = sandbox.exports.default({ navigation });
    if (firstRender) { firstRender = false; for (const effect of effects) effect(); }
    return tree;
  }
  function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []; }
  function find(label) { return nodes(render()).find(node => node.props.accessibilityLabel === label); }
  function modal() { return nodes(render()).find(node => node.type === 'Modal'); }
  render();
  return { find, modal, render, nodes, listeners, alerts, requests: () => requests };
}

test('account deletion requires opening confirmation and typing DELETE; cancel resets it without API calls', async () => {
  const fixture = componentFixture();
  assert.equal(fixture.modal().props.visible, false);
  fixture.find('Delete account').props.onPress();
  assert.equal(fixture.modal().props.visible, true);
  const action = () => fixture.find('Permanently delete account');
  assert.equal(action().props.disabled, true);
  for (const text of ['', 'delete', 'DELETE ', 'DELET']) {
    fixture.find('Type DELETE to confirm').props.onChangeText(text);
    await action().props.onPress();
    assert.equal(action().props.disabled, true);
    assert.equal(fixture.requests(), 0);
  }
  fixture.find('Type DELETE to confirm').props.onChangeText('DELETE');
  assert.equal(action().props.disabled, false);
  fixture.find('Cancel account deletion').props.onPress();
  assert.equal(fixture.modal().props.visible, false);
  assert.equal(fixture.find('Type DELETE to confirm').props.value, '');
  assert.equal(fixture.requests(), 0);
});

test('the destructive action sends once, remains busy, and reports confirmed deletion', async () => {
  let finish;
  const fixture = componentFixture(() => new Promise(resolve => { finish = resolve; }));
  fixture.find('Delete account').props.onPress();
  fixture.find('Type DELETE to confirm').props.onChangeText('DELETE');
  const click = fixture.find('Permanently delete account').props.onPress;
  const pending = click();
  await click();
  assert.equal(fixture.requests(), 1);
  assert.equal(fixture.find('Permanently delete account').props.disabled, true);
  assert.equal(fixture.find('Type DELETE to confirm').props.editable, false);
  fixture.find('Cancel account deletion').props.onPress();
  assert.equal(fixture.modal().props.visible, true);
  finish({ deleted: true, localCleared: true });
  await pending;
  assert.equal(fixture.modal().props.visible, false);
  assert.equal(fixture.alerts[0][0], 'Account deleted');
});

test('a failed request keeps confirmation open and allows a deliberate retry', async () => {
  const fixture = componentFixture(async () => { throw new Error('Network unavailable'); });
  fixture.find('Delete account').props.onPress();
  fixture.find('Type DELETE to confirm').props.onChangeText('DELETE');
  await fixture.find('Permanently delete account').props.onPress();
  assert.equal(fixture.modal().props.visible, true);
  assert.equal(fixture.find('Permanently delete account').props.disabled, false);
  assert.equal(fixture.alerts.length, 0);
  const error = fixture.nodes(fixture.render()).find(node => node.props.accessibilityRole === 'alert');
  assert.match(error.children.join(''), /could not be confirmed/);
  await fixture.find('Permanently delete account').props.onPress();
  assert.equal(fixture.requests(), 2);
});

test('leaving the screen or backgrounding closes an unsubmitted deletion confirmation', () => {
  const fixture = componentFixture();
  for (const leave of [() => fixture.listeners.blur(), () => fixture.listeners.background('background')]) {
    fixture.find('Delete account').props.onPress();
    fixture.find('Type DELETE to confirm').props.onChangeText('DELETE');
    leave();
    assert.equal(fixture.modal().props.visible, false);
    assert.equal(fixture.find('Type DELETE to confirm').props.value, '');
    assert.equal(fixture.requests(), 0);
  }
});
