'use strict';

const { randomUUID } = require('node:crypto');
const REPOSITORY = 'UFIConnect/UFIConnect';
const WORKFLOW = 'office-terminal.yml';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/i;
const ACTIVE = ['dispatching', 'dispatch_uncertain', 'queued', 'running'];
const SCHEMA = `CREATE TABLE IF NOT EXISTS office_ai_terminal_sessions (
  id UUID PRIMARY KEY, client_request_id UUID UNIQUE NOT NULL, command TEXT NOT NULL,
  requested_ref TEXT NOT NULL, commit_sha TEXT NOT NULL, timeout_seconds INTEGER NOT NULL,
  status TEXT NOT NULL, run_id BIGINT UNIQUE, conclusion TEXT, exit_code INTEGER,
  cancellation_requested BOOLEAN NOT NULL DEFAULT false, error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const clean = value => String(value || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

async function readBounded(response, limit = 262144, truncate = false) {
  const reader = response.body?.getReader();
  if (!reader) throw fail(502, 'GitHub returned an unreadable response.');
  const chunks = []; let size = 0, truncated = false;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (size + part.value.byteLength > limit) {
        if (!truncate) throw fail(502, 'GitHub returned an oversized response.');
        chunks.push(part.value.subarray(0, limit - size)); truncated = true; break;
      }
      chunks.push(part.value); size += part.value.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

function validate(body) {
  if (!object(body) || Object.keys(body).some(key => !['clientRequestId', 'command', 'ref', 'timeoutSeconds'].includes(key))) throw fail(400, 'Use the supported terminal fields.');
  if (typeof body.clientRequestId !== 'string' || !UUID.test(body.clientRequestId)) throw fail(400, 'A terminal request ID is required.');
  if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 12000 || /\u0000/.test(body.command)) throw fail(400, 'Enter a command of up to 12,000 characters.');
  const ref = body.ref || 'main', timeoutSeconds = body.timeoutSeconds ?? 120;
  if (typeof ref !== 'string' || ref !== 'main' && !SHA.test(ref)) throw fail(400, 'Use main or a complete commit SHA from this repository.');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 300) throw fail(400, 'Choose a command timeout from 30 to 300 seconds.');
  return { clientRequestId: body.clientRequestId.toLowerCase(), command: body.command.trim(), ref: ref.toLowerCase(), timeoutSeconds };
}

function createOfficeTerminal({ db, env = process.env, fetcher = fetch, now = Date.now } = {}) {
  let ready; const refreshing = new Map();
  const token = () => env.OFFICE_GITHUB_TOKEN || env.AUTOFIX_GITHUB_TOKEN || '';
  const scrub = value => Object.entries(env).filter(([key, value]) => /TOKEN|SECRET|API_KEY|PASSWORD|DATABASE_URL/i.test(key) && typeof value === 'string' && value.length >= 8)
    .reduce((text, [, secret]) => text.split(secret).join('[credential redacted]'), clean(value));
  function capabilities() {
    const configured = Boolean(token());
    return { configured, available: configured && Boolean(db?.isConnected?.()), target: 'github-actions-ubuntu', repository: REPOSITORY,
      workflow: WORKFLOW, maxTimeoutSeconds: 300, maxCommandCharacters: 12000,
      note: 'Commands run in an isolated Node container on an Ubuntu GitHub Actions runner, not on production servers. Files do not persist between commands. Workflow logs are public in this public repository. Never include credentials. GitHub Actions write permission and the published terminal workflow are required.' };
  }
  async function storage() {
    if (!db?.isConnected?.() || typeof db.withClient !== 'function') throw fail(503, 'Terminal session storage is unavailable.');
    if (!ready) ready = db.query(SCHEMA).catch(error => { ready = null; throw error; });
    await ready;
  }
  async function github(path, { method = 'GET', body, signal, allow = [] } = {}) {
    if (!token()) throw fail(503, 'Connect GitHub with Actions read and write permissions to use the terminal.');
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method, redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'UFIConnect-Office/1.0', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok && !allow.includes(response.status)) {
      await response.body?.cancel?.().catch(() => {});
      throw fail(response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 409 : 502,
        response.status === 401 || response.status === 403 ? 'GitHub denied this terminal operation. Check Actions read/write permissions.' : response.status === 404 ? 'The terminal workflow or commit is not available in this repository.' : 'GitHub could not complete the terminal operation.');
    }
    return response;
  }
  async function json(path, options) { const response = await github(path, options); return JSON.parse((await readBounded(response, 1048576)).text); }
  function session(row) {
    return { id: row.id, clientRequestId: row.client_request_id, command: scrub(row.command), ref: row.requested_ref, commitSha: row.commit_sha,
      timeoutSeconds: row.timeout_seconds, status: row.status, runId: row.run_id ? String(row.run_id) : null,
      runUrl: row.run_id ? `https://github.com/${REPOSITORY}/actions/runs/${row.run_id}` : null,
      conclusion: row.conclusion || null, exitCode: row.exit_code ?? null, cancellationRequested: row.cancellation_requested,
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), error: row.error || null };
  }
  async function rowById(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw fail(400, 'Use a valid terminal session ID.');
    const row = (await db.query('SELECT * FROM office_ai_terminal_sessions WHERE id=$1', [id])).rows[0];
    if (!row) throw fail(404, 'This terminal session was not found.');
    return row;
  }
  async function store(row, changes) {
    const next = { ...row, ...changes };
    const result = await db.query(`UPDATE office_ai_terminal_sessions SET
      status=CASE WHEN status NOT IN ('dispatching','dispatch_uncertain','queued','running') AND $2 IN ('dispatching','dispatch_uncertain','queued','running') THEN status ELSE $2 END,
      run_id=COALESCE(run_id,$3),conclusion=COALESCE($4,conclusion),exit_code=COALESCE($5,exit_code),cancellation_requested=cancellation_requested OR $6,error=$7,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [row.id, next.status, next.run_id || null, next.conclusion || null, next.exit_code ?? null, !!next.cancellation_requested, next.error || null]);
    return result.rows[0];
  }
  async function refresh(row) {
    if (!ACTIVE.includes(row.status)) return row;
    if (refreshing.has(row.id)) return refreshing.get(row.id);
    const promise = (async () => {
      let run;
      if (row.run_id) run = await json(`/actions/runs/${row.run_id}`);
      else {
        const since = new Date(new Date(row.created_at).getTime() - 60000).toISOString();
        const data = await json(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100&created=${encodeURIComponent('>=' + since)}`);
        const matches = (data.workflow_runs || []).filter(item => item.display_title === `Office terminal ${row.id}` && item.event === 'workflow_dispatch');
        if (matches.length > 1) throw fail(409, 'More than one GitHub run matches this terminal receipt. Open GitHub to review; no replay was sent.');
        run = matches[0];
      }
      if (!run) return row;
      if (!Number.isSafeInteger(run.id) || run.id <= 0 || run.display_title !== `Office terminal ${row.id}` || run.event !== 'workflow_dispatch'
        || run.repository?.full_name && run.repository.full_name.toLowerCase() !== REPOSITORY.toLowerCase()) throw fail(502, 'GitHub returned a mismatched terminal run.');
      let status = run.status === 'completed' ? run.conclusion === 'success' ? 'completed' : run.conclusion === 'cancelled' ? 'cancelled' : run.conclusion === 'timed_out' ? 'timed_out' : 'failed'
        : run.status === 'in_progress' ? 'running' : 'queued';
      row = await store(row, { run_id: run.id, status, conclusion: run.conclusion, error: null });
      if (row.cancellation_requested && ACTIVE.includes(status)) {
        const response = await github(`/actions/runs/${run.id}/cancel`, { method: 'POST', allow: [409] }); await response.body?.cancel?.().catch(() => {});
      }
      return row;
    })();
    refreshing.set(row.id, promise);
    try { return await promise; } finally { refreshing.delete(row.id); }
  }
  async function startSession(body, { signal } = {}) {
    const input = validate(body); await storage();
    if (scrub(input.command) !== clean(input.command)) throw fail(400, 'Do not put Office credentials in terminal commands.');
    const existing = (await db.query('SELECT * FROM office_ai_terminal_sessions WHERE client_request_id=$1', [input.clientRequestId])).rows[0];
    function same(row) { return row.command === input.command && row.requested_ref === input.ref && row.timeout_seconds === input.timeoutSeconds; }
    if (existing) {
      if (!same(existing)) throw fail(409, 'This request ID already belongs to a different terminal command.');
      // Creation retries acknowledge the durable receipt even while GitHub
      // is unavailable or has not exposed a newly dispatched run yet. Status
      // reconciliation belongs to GET and must never make a saved command
      // look as though its creation failed or invite a second dispatch.
      return session(existing);
    }
    const commit = await json(`/commits/${input.ref}`, { signal });
    if (!SHA.test(commit.sha || '') || input.ref !== 'main' && commit.sha.toLowerCase() !== input.ref) throw fail(502, 'GitHub did not resolve the requested commit.');
    const workflow = await json(`/actions/workflows/${WORKFLOW}`, { signal });
    if (workflow.state !== 'active' || workflow.path !== `.github/workflows/${WORKFLOW}`) throw fail(409, 'Publish and enable the Office terminal workflow before running commands.');
    // Reconcile the two possible outstanding jobs before capacity accounting;
    // a completed session must not block commands after a browser was closed.
    const outstanding = (await db.query('SELECT * FROM office_ai_terminal_sessions WHERE status=ANY($1::text[]) ORDER BY created_at LIMIT 2', [ACTIVE])).rows;
    for (const row of outstanding) await refresh(row);
    const reserved = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '10s'");
        await client.query('SELECT pg_advisory_xact_lock(813702493)');
        const duplicate = (await client.query('SELECT * FROM office_ai_terminal_sessions WHERE client_request_id=$1', [input.clientRequestId])).rows[0];
        if (duplicate) { if (!same(duplicate)) throw fail(409, 'This request ID already belongs to a different terminal command.'); await client.query('COMMIT'); return { row: duplicate, created: false }; }
        const counts = (await client.query(`SELECT count(*) FILTER(WHERE status=ANY($1::text[]))::int AS active,count(*) FILTER(WHERE created_at>NOW()-INTERVAL '1 hour')::int AS recent FROM office_ai_terminal_sessions`, [ACTIVE])).rows[0];
        if (counts.active >= 2 || counts.recent >= 20) throw fail(429, 'Terminal capacity is busy. Finish existing sessions or try again later.');
        const result = await client.query(`INSERT INTO office_ai_terminal_sessions(id,client_request_id,command,requested_ref,commit_sha,timeout_seconds,status) VALUES($1,$2,$3,$4,$5,$6,'dispatching') RETURNING *`,
          [randomUUID(), input.clientRequestId, input.command, input.ref, commit.sha, input.timeoutSeconds]);
        await client.query('COMMIT'); return { row: result.rows[0], created: true };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
    if (!reserved.created) return session(reserved.row);
    let row = reserved.row;
    try {
      const response = await github(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', signal,
        body: { ref: 'main', inputs: { session_id: row.id, commit_sha: row.commit_sha, command_b64: Buffer.from(row.command).toString('base64'), timeout_seconds: String(row.timeout_seconds) } } });
      // API 2026-03-10 returns the run ID directly. Keep the historical 204
      // path for provider compatibility, and reconcile uncertain dispatches
      // by the unique run-name rather than ever sending them twice.
      let runId = null;
      if (response.status === 200) {
        const receipt = JSON.parse((await readBounded(response, 65536)).text);
        if (!Number.isSafeInteger(receipt.workflow_run_id) || receipt.workflow_run_id <= 0) throw Error('Unusable workflow run receipt.');
        runId = receipt.workflow_run_id;
      } else if (response.status === 204) await response.body?.cancel?.().catch(() => {});
      else throw Error('Unrecognized workflow dispatch receipt.');
      row = await store(row, { status: 'queued', run_id: runId });
    } catch (error) {
      // A connection loss after dispatch does not prove rejection. This record
      // must be reconciled by its unique run-name; never resend automatically.
      row = await store(row, { status: error.status === 403 || error.status === 409 ? 'failed' : 'dispatch_uncertain',
        error: error.publicMessage || 'GitHub dispatch outcome is unknown. Refresh this session; it will not be sent again.' });
    }
    return session(row);
  }
  async function logs(row) {
    if (!row.run_id) return { output: '', outputTruncated: false, logsAvailable: false };
    const data = await json(`/actions/runs/${row.run_id}/jobs?per_page=10`);
    const job = (data.jobs || []).find(item => item.name === 'Office workspace');
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || job.status !== 'completed') return { output: '', outputTruncated: false, logsAvailable: false };
    let response = await github(`/actions/jobs/${job.id}/logs`, { allow: [302, 404] });
    if (response.status === 404) return { output: '', outputTruncated: false, logsAvailable: false };
    if (response.status === 302) {
      const location = response.headers.get('location'); await response.body?.cancel?.().catch(() => {});
      let url; try { url = new URL(location); } catch { throw fail(502, 'GitHub log download address was invalid.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.blob.core.windows.net', '.actions.githubusercontent.com', '.githubusercontent.com'].some(suffix => url.hostname.endsWith(suffix))) throw fail(502, 'GitHub log download address was not trusted.');
      response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(15000) }); // Never forward GitHub credentials to storage.
      if (!response.ok) throw fail(502, 'GitHub logs are not available yet.');
    }
    const result = await readBounded(response, 262144, true), output = scrub(result.text);
    let outputTruncated = result.truncated;
    const receipt = output.split('\n').filter(line => line.includes('OFFICE_TERMINAL_RECEIPT ')).at(-1);
    if (receipt && !result.truncated) {
      try {
        const value = JSON.parse(receipt.slice(receipt.indexOf('OFFICE_TERMINAL_RECEIPT ') + 'OFFICE_TERMINAL_RECEIPT '.length));
        if (value.sessionId === row.id && value.commitSha === row.commit_sha && (value.exitCode === null || Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)) {
          row = await store(row, { exit_code: value.exitCode, ...(value.timedOut ? { status: 'timed_out' } : {}) });
          outputTruncated ||= value.outputTruncated === true;
        }
      } catch { /* No actual exit code is inferred from incomplete logs. */ }
    }
    return { output, outputTruncated, logsAvailable: true, row };
  }
  async function getSession(id) {
    await storage(); let row = await refresh(await rowById(id)); const result = await logs(row); row = result.row || row;
    return { session: session(row), output: result.output, outputTruncated: result.outputTruncated, logsAvailable: result.logsAvailable };
  }
  async function cancelSession(id) {
    await storage(); let row = await refresh(await rowById(id));
    if (!ACTIVE.includes(row.status)) return session(row);
    row = await store(row, { cancellation_requested: true });
    if (row.run_id) { const response = await github(`/actions/runs/${row.run_id}/cancel`, { method: 'POST', allow: [409] }); await response.body?.cancel?.().catch(() => {}); }
    return session(row); // GitHub must confirm completion before status becomes cancelled.
  }
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return await fn(req, res); }
    catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'Terminal operation is unavailable. Retry the same request ID if needed.' }); }
  };
  const list = handle(async (_req, res) => {
    await storage(); const rows = (await db.query('SELECT * FROM office_ai_terminal_sessions ORDER BY created_at DESC LIMIT 30')).rows;
    return res.json({ capabilities: capabilities(), sessions: rows.map(session) });
  });
  const create = handle(async (req, res) => res.status(202).json({ session: await startSession(req.body) }));
  const status = handle(async (req, res) => res.json(await getSession(req.params.id)));
  const cancel = handle(async (req, res) => res.json({ session: await cancelSession(req.params.id) }));
  const idParameters = { type: 'object', properties: { id: { type: 'string', description: 'Terminal session UUID.' } }, required: ['id'], additionalProperties: false };
  const tools = {
    terminal_run: { description: 'Run an owner-authorized command in a disposable Ubuntu repository checkout. Public logs; no production credentials or persistent shell. Reuse clientRequestId when retrying.', permission: 'editCode', parameters: { type: 'object', properties: { clientRequestId: { type: 'string' }, command: { type: 'string', maxLength: 12000 }, ref: { type: 'string' }, timeoutSeconds: { type: 'integer', minimum: 30, maximum: 300 } }, required: ['clientRequestId', 'command'], additionalProperties: false }, execute: startSession },
    terminal_status: { description: 'Read an existing terminal job receipt and bounded completed-job logs.', permission: 'read', parameters: idParameters, execute: args => getSession(args.id) },
    terminal_cancel: { description: 'Request cancellation of an existing terminal job; GitHub confirms its final status.', permission: 'editCode', parameters: idParameters, execute: args => cancelSession(args.id) },
  };
  return { list, create, status, cancel, capabilities, startSession, getSession, cancelSession, tools };
}

module.exports = { createOfficeTerminal, OFFICE_TERMINAL_SCHEMA: SCHEMA, validateTerminal: validate, readBounded };
