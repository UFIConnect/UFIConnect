'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createOfficeTerminal, validateTerminal, readBounded } = require('./office-ai-terminal');
const SHA = 'a'.repeat(40);
const TOKEN = 'github-fixture-credential-never-public';
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  const query = (sql, params) => sql.startsWith('SELECT pg_advisory_xact_lock') ? Promise.resolve({ rows: [] }) : pg.query(sql, params);
  const db = { query, isConnected: () => true, withClient: fn => fn({ query }) };
  const state = { calls: [], dispatches: [], runs: [], failDispatch: false, directReceipt: false, logUrl: 'https://logs.blob.core.windows.net/job?signature=fixture', output: '' };
  const env = { OFFICE_GITHUB_TOKEN: TOKEN, RENDER_API_KEY: 'render-fixture-private-secret' };
  async function fetcher(url, options = {}) {
    state.calls.push({ url: String(url), options });
    const parsed = new URL(url), route = parsed.pathname.replace('/repos/UFIConnect/UFIConnect', '');
    if (parsed.hostname.endsWith('.blob.core.windows.net')) { assert.equal(options.headers?.Authorization, undefined); return new Response(state.output); }
    assert.equal(parsed.origin, 'https://api.github.com'); assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    if (route.startsWith('/commits/')) return json({ sha: SHA });
    if (route === '/actions/workflows/office-terminal.yml') return json({ path: '.github/workflows/office-terminal.yml', state: 'active' });
    if (route.endsWith('/dispatches')) {
      const body = JSON.parse(options.body); state.dispatches.push(body);
      state.runs.push({ id: state.dispatches.length + 100, display_title: `Office terminal ${body.inputs.session_id}`, event: 'workflow_dispatch', status: 'queued', conclusion: null, repository: { full_name: 'UFIConnect/UFIConnect' } });
      if (state.failDispatch) throw Error('socket disconnected with secret ' + TOKEN);
      if (state.directReceipt) return json({ workflow_run_id: state.runs.at(-1).id, html_url: `https://github.com/UFIConnect/UFIConnect/actions/runs/${state.runs.at(-1).id}` });
      return new Response(null, { status: 204 });
    }
    if (route === '/actions/workflows/office-terminal.yml/runs') return json({ workflow_runs: state.runs });
    if (/\/actions\/runs\/\d+$/.test(route)) return json(state.runs.find(run => String(run.id) === route.split('/').at(-1)));
    if (route.endsWith('/cancel')) return new Response(null, { status: 202 });
    if (route.endsWith('/jobs')) return json({ jobs: [{ id: 500, name: 'Office workspace', status: state.runs[0].status }] });
    if (route === '/actions/jobs/500/logs') return new Response(null, { status: 302, headers: { location: state.logUrl } });
    throw Error('Unexpected route ' + route);
  }
  return { app: createOfficeTerminal({ db, env, fetcher }), recreate: () => createOfficeTerminal({ db, env, fetcher }), state, db, env };
}

test('terminal dispatch is pinned, durable and idempotent across manager recreation', async t => {
  const f = await fixture(t), input = { clientRequestId: randomUUID(), command: 'node --version', ref: 'main', timeoutSeconds: 60 };
  const first = await f.app.startSession(input);
  assert.equal(first.status, 'queued'); assert.equal(first.runId, null); assert.equal(first.commitSha, SHA);
  assert.equal(f.state.dispatches[0].ref, 'main'); assert.equal(f.state.dispatches[0].inputs.commit_sha, SHA);
  assert.equal(Buffer.from(f.state.dispatches[0].inputs.command_b64, 'base64').toString(), input.command);
  const again = await f.recreate().startSession(input);
  assert.equal(again.id, first.id); assert.equal(again.runId, '101'); assert.equal(f.state.dispatches.length, 1);
  await assert.rejects(f.app.startSession({ ...input, command: 'echo changed' }), { status: 409 });
  const rows = await f.db.query('SELECT * FROM office_ai_terminal_sessions'); assert.equal(rows.rows.length, 1);
});

test('ambiguous dispatch reconciles a unique run receipt without replaying a command', async t => {
  const f = await fixture(t); f.state.failDispatch = true;
  const input = { clientRequestId: randomUUID(), command: 'npm test', ref: SHA };
  const first = await f.app.startSession(input); assert.equal(first.status, 'dispatch_uncertain'); assert.ok(!JSON.stringify(first).includes(TOKEN));
  const next = await f.app.startSession(input); assert.equal(next.status, 'queued'); assert.equal(next.id, first.id); assert.equal(f.state.dispatches.length, 1);
});

test('current GitHub dispatch API returns a direct durable run receipt', async t => {
  const f = await fixture(t); f.state.directReceipt = true;
  const input = { clientRequestId: randomUUID(), command: 'node --version' };
  const first = await f.app.startSession(input);
  assert.equal(first.runId, '101'); assert.equal(first.runUrl, 'https://github.com/UFIConnect/UFIConnect/actions/runs/101');
  const restored = await f.recreate().startSession(input); assert.equal(restored.id, first.id); assert.equal(restored.runId, '101');
  assert.equal(f.state.dispatches.length, 1); assert.ok(!f.state.calls.some(call => call.url.includes('/office-terminal.yml/runs?')));
});

test('cancellation is an intent until GitHub confirms the terminal run stopped', async t => {
  const f = await fixture(t), first = await f.app.startSession({ clientRequestId: randomUUID(), command: 'sleep 20' });
  const cancel = await f.app.cancelSession(first.id); assert.equal(cancel.cancellationRequested, true); assert.equal(cancel.status, 'queued');
  f.state.runs[0].status = 'completed'; f.state.runs[0].conclusion = 'cancelled';
  f.state.output = 'cancelled by owner';
  const done = await f.app.getSession(first.id); assert.equal(done.session.status, 'cancelled'); assert.equal(done.session.exitCode, null);
});

test('completed terminal logs preserve actual exit codes, truncate safely and redact credentials', async t => {
  const f = await fixture(t), first = await f.app.startSession({ clientRequestId: randomUUID(), command: 'printf hello' });
  f.state.runs[0].status = 'completed'; f.state.runs[0].conclusion = 'failure';
  f.state.output = `hello ${TOKEN}\nOFFICE_TERMINAL_RECEIPT ${JSON.stringify({ sessionId: first.id, commitSha: SHA, exitCode: 7, timedOut: false, outputTruncated: true })}\n`;
  const result = await f.app.getSession(first.id);
  assert.equal(result.session.status, 'failed'); assert.equal(result.session.exitCode, 7); assert.equal(result.outputTruncated, true);
  assert.equal(result.logsAvailable, true); assert.ok(result.output.includes('[credential redacted]')); assert.ok(!result.output.includes(TOKEN));
  assert.equal(f.state.calls.at(-1).options.headers, undefined);
});

test('terminal rejects secret commands, invalid refs and untrusted signed log redirects', async t => {
  const f = await fixture(t);
  await assert.rejects(f.app.startSession({ clientRequestId: randomUUID(), command: 'echo ' + TOKEN }), { status: 400 });
  assert.equal(f.state.calls.length, 0);
  for (const body of [{ ref: '../../main' }, { timeoutSeconds: 301 }, { command: 'a\0b' }, { extra: true }]) assert.throws(() => validateTerminal({ clientRequestId: randomUUID(), command: 'echo okay', ...body }), { status: 400 });
  const first = await f.app.startSession({ clientRequestId: randomUUID(), command: 'echo okay' });
  f.state.runs[0].status = 'completed'; f.state.runs[0].conclusion = 'success'; f.state.logUrl = 'https://attacker.example/private';
  await assert.rejects(f.app.getSession(first.id), { status: 502 });
  assert.ok(!f.state.calls.some(call => call.url.includes('attacker.example')));
});

test('missing GitHub connection and oversized provider payloads fail closed', async t => {
  const f = await fixture(t); f.env.OFFICE_GITHUB_TOKEN = '';
  assert.equal(f.app.capabilities().available, false);
  await assert.rejects(f.app.startSession({ clientRequestId: randomUUID(), command: 'echo okay' }), { status: 503 });
  assert.equal(f.state.calls.length, 0);
  await assert.rejects(readBounded(new Response('x'.repeat(30)), 20), { status: 502 });
  const cut = await readBounded(new Response('x'.repeat(30)), 20, true); assert.equal(cut.text.length, 20); assert.equal(cut.truncated, true);
});

test('trusted workflow runner isolates command environment and reports real command failure', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/office-terminal.yml'), 'utf8');
  assert.match(workflow, /persist-credentials: false/); assert.match(workflow, /permissions:\s+contents: read/); assert.doesNotMatch(workflow, /secrets\./);
  const programs = [...workflow.matchAll(/node <<'NODE'\n([\s\S]*?)\n          NODE/g)]; assert.equal(programs.length, 2);
  const code = programs[1][1].split('\n').map(line => line.slice(10)).join('\n');
  const child = new EventEmitter(); child.pid = 123; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const output = [], command = 'printf "$(literal)"; exit 7'; let spawned;
  const context = { Buffer, console: { log: text => output.push(text) }, setTimeout: () => 1, clearTimeout: () => {},
    process: { env: { SESSION_ID: randomUUID(), COMMIT_SHA: SHA, COMMAND_B64: Buffer.from(command).toString('base64'), TIMEOUT_SECONDS: '30', PATH: '/bin', HOME: '/home/runner', GITHUB_WORKSPACE: '/workspace', GITHUB_TOKEN: TOKEN, ACTIONS_RUNTIME_TOKEN: 'private-runtime' }, stdout: { write: text => output.push(text) }, kill: () => {}, getuid: () => 1001, getgid: () => 1001, on: () => {} },
    require: name => name === 'node:crypto' ? { randomUUID } : { spawn: (...args) => { spawned = args; return child; }, spawnSync: () => ({ status: 0 }) } };
  vm.runInNewContext(code, context);
  assert.equal(spawned[0], 'docker'); assert.equal(spawned[1].at(-1), 'mkdir -p "$HOME"; ' + command); assert.equal(spawned[2].cwd, '/workspace');
  for (const option of ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=2g', '--cpus=2', '--read-only', '--network=bridge']) assert.ok(spawned[1].includes(option));
  assert.equal(spawned[1][spawned[1].indexOf('--user') + 1], '1001:1001');
  assert.equal(spawned[1].filter(arg => arg.startsWith('type=bind')).length, 1);
  assert.ok(!spawned[1].some(arg => /docker\.sock|--privileged|--pid=host|--network=host/.test(arg)));
  assert.equal(spawned[2].env.GITHUB_TOKEN, undefined); assert.equal(spawned[2].env.ACTIONS_RUNTIME_TOKEN, undefined); assert.equal(spawned[2].env.COMMAND_B64, undefined);
  child.stdout.emit('data', Buffer.from('result\n')); child.emit('close', 7, null);
  assert.equal(context.process.exitCode, 7); const receipt = JSON.parse(output.find(line => line.startsWith('OFFICE_TERMINAL_RECEIPT ')).slice('OFFICE_TERMINAL_RECEIPT '.length));
  assert.equal(receipt.exitCode, 7); assert.equal(receipt.timedOut, false); assert.ok(output.some(line => line.startsWith('::stop-commands::')));
});

test('workflow timeout and output limits kill the container and preserve an honest incomplete exit receipt', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/office-terminal.yml'), 'utf8');
  const code = [...workflow.matchAll(/node <<'NODE'\n([\s\S]*?)\n          NODE/g)][1][1].split('\n').map(line => line.slice(10)).join('\n');
  for (const reason of ['timeout', 'output']) {
    const child = new EventEmitter(); child.pid = 123; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const output = [], removals = []; let deadline;
    const context = { Buffer, console: { log: line => output.push(line) }, setTimeout: callback => { deadline = callback; return 1; }, clearTimeout() {},
      process: { env: { SESSION_ID: randomUUID(), COMMIT_SHA: SHA, COMMAND_B64: Buffer.from('sleep 1000').toString('base64'), TIMEOUT_SECONDS: '30', PATH: '/bin', GITHUB_WORKSPACE: '/workspace' },
        stdout: { write: line => output.push(line) }, kill() {}, getuid: () => 1001, getgid: () => 1001, on() {} },
      require: name => name === 'node:crypto' ? { randomUUID } : { spawn: () => child, spawnSync: (binary, args) => { removals.push({ binary, args }); return { status: 0 }; } } };
    vm.runInNewContext(code, context);
    if (reason === 'timeout') deadline(); else child.stdout.emit('data', Buffer.alloc(200000, 120));
    child.emit('close', null, 'SIGKILL');
    assert.ok(removals.length > 0); assert.ok(removals.every(item => item.binary === 'docker' && item.args[0] === 'rm' && item.args[1] === '-f' && item.args[2].startsWith('office-terminal-')));
    const receipt = JSON.parse(output.find(line => line.startsWith('OFFICE_TERMINAL_RECEIPT ')).slice('OFFICE_TERMINAL_RECEIPT '.length));
    assert.equal(receipt.exitCode, null); assert.equal(receipt.timedOut, reason === 'timeout'); assert.equal(receipt.outputTruncated, reason === 'output');
    assert.equal(context.process.exitCode, reason === 'timeout' ? 124 : 125);
    if (reason === 'output') assert.ok(output.reduce((sum, line) => sum + line.length, 0) < 170000);
  }
});
