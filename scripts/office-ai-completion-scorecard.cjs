'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scenarios = [
  { id: 'data-results', goal: 'Compute useful table statistics with honest grouping coverage and numeric failure handling.',
    files: ['backend/office-ai-data.test.js'],
    exercised: ['Static production analysis code executes against real CSV/JSON rows', 'All-row totals and first-100 group omissions', 'Overflow rejection before null statistics can escape'],
    limits: 'The production helper is executed locally; this does not measure Cloudflare availability or spreadsheet reasoning.' },
  { id: 'research-and-saved-artifacts', goal: 'Distinguish inspected evidence and save recoverable, versioned files.',
    files: ['backend/office-ai-extensions.test.js', 'backend/office-ai-workspace.test.js'],
    exercised: ['Research search snippets versus actual page text and unavailable sources', 'Encrypted database writes, verified reads, stale-version rejection and idempotent file retries', 'Sandbox transport receipts, reusable functions and encrypted draft recovery'],
    limits: 'PGlite storage and the authored helper execute; network/provider responses are controlled fixtures, not live research or provider calls.' },
  { id: 'execution-repair-and-approval', goal: 'Carry persisted tasks through actual handlers, recover failures and wait for exact deployment approval.',
    files: ['backend/office-ai-tasks.test.js', 'backend/office-ai-execution.test.js'],
    exercised: ['Persisted task state, file receipts and automatically corrected failed checks', 'Automatic checkpoints, terminal completion and completed-operation nonreplay', 'Exact-source approval, cancellation, rebase/drift renewal and blocked legacy publication bypasses'],
    limits: 'The actual task engine and database execute with scripted model/repository/provider responses. This is not an autonomous model-quality benchmark or a real deployment.' },
  { id: 'source-and-release-integrity', goal: 'Preserve source correctness and enforce verified immutable deployment inputs.',
    files: ['backend/office-ai-repository.test.js', 'backend/office-ai-cloudflare.test.js', 'infra/office-ai-worker/index.test.mjs'],
    exercised: ['Exact edits, immutable candidates, failed-check rejection and safe rebasing', 'Lost-response reconciliation and source-integrity checks', 'Worker source/version checks, native truncation propagation and existing secret-binding preservation'],
    limits: 'Actual adapter functions execute against controlled HTTP fixtures. No repository publication, infrastructure change or deployment occurs.' },
  { id: 'recovery-and-requirements', goal: 'Retain original work requirements and useful results across model failure and context compaction.',
    files: ['backend/office-ai-model-recovery.test.js', 'backend/office-ai-task-context.test.js'],
    exercised: ['Bounded recovery, compatible-model routing and cancellation', 'Original plan, saved artifact receipts, failed checks and unresolved edits after compaction', 'Explicit omitted-receipt counts and redaction'],
    limits: 'Recovery uses controlled inference responses and clocks. It does not establish live provider resilience or comparative model intelligence.' },
];

function sourceFingerprint() {
  const files = fs.readdirSync(path.join(root, 'backend')).filter(name => name.endsWith('.js')).map(name => `backend/${name}`);
  for (const directory of ['infra/office-ai-worker', 'infra/office-ai-site']) {
    for (const name of fs.readdirSync(path.join(root, directory))) if (/\.(?:mjs|jsonc)$/.test(name)) files.push(`${directory}/${name}`);
  }
  files.sort();
  const receipts = files.map(file => ({ path: file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
  return { algorithm: 'sha256', scope: 'All backend JavaScript and Office AI Worker source/configuration files',
    digest: createHash('sha256').update(JSON.stringify(receipts)).digest('hex'), files: receipts };
}

function runScenario(scenario) {
  const args = ['--test', '--test-isolation=none', '--test-reporter=tap', ...scenario.files];
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '', failure = '', bytes = 0;
    const collect = (text, errorStream) => {
      bytes += Buffer.byteLength(text);
      if (bytes > 4 * 1024 * 1024) { failure = 'Test output exceeded the scorecard capture limit.'; child.kill(); return; }
      if (errorStream) stderr += text; else output += text;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => collect(text, false)); child.stderr.on('data', text => collect(text, true));
    const timeout = setTimeout(() => { failure = 'The scenario exceeded its ten-minute execution allowance.'; child.kill(); }, 10 * 60 * 1000);
    child.on('error', error => { failure = `The test process could not start: ${error.code || error.message}`; });
    child.on('close', code => {
      clearTimeout(timeout);
      const count = name => {
        const match = output.match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
        return match ? Number(match[1]) : null;
      };
      const counts = { tests: count('tests'), passed: count('pass'), failed: count('fail'), cancelled: count('cancelled'), skipped: count('skipped'), todo: count('todo') };
      const testNames = [...output.matchAll(/^\s*# Subtest: (.+)$/gm)].map(match => match[1]);
      const passed = !failure && code === 0 && counts.tests > 0 && counts.passed === counts.tests
        && counts.failed === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0 && testNames.length > 0;
      resolve({ ...scenario, command: [path.basename(process.execPath), ...args], status: passed ? 'passed' : 'failed',
        durationMs: Date.now() - started, exitCode: code, counts, testNames,
        ...(!passed ? { diagnostic: failure || 'One or more tests failed, were skipped, or did not produce a complete test receipt.', output: (output + stderr).slice(-24000) } : {}) });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--output' && args[1])) {
    throw new Error('Usage: node scripts/office-ai-completion-scorecard.cjs [--output report.json]');
  }
  const startedAt = new Date().toISOString();
  const before = sourceFingerprint();
  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running ${scenario.id} (${scenario.files.length} complete test file${scenario.files.length === 1 ? '' : 's'})...\n`);
    const result = await runScenario(scenario);
    results.push(result);
    process.stdout.write(`${result.status.toUpperCase()} ${scenario.id}: ${result.counts.passed ?? 0}/${result.counts.tests ?? 0} tests, ${result.durationMs} ms\n`);
  }
  const after = sourceFingerprint(), unchanged = before.digest === after.digest;
  const report = { schemaVersion: 1, title: 'UFIConnect one-request completion scorecard', startedAt, completedAt: new Date().toISOString(),
    nodeVersion: process.version, evaluation: 'Deterministic component and workflow regression tests; complete listed test files run without test-name filters.',
    comparison: { competitorRuns: 0, superiorityEstablished: false }, source: before, sourceUnchangedDuringRun: unchanged,
    summary: { scenarios: results.length, passedScenarios: results.filter(result => result.status === 'passed').length,
      tests: results.reduce((sum, result) => sum + (result.counts.tests || 0), 0), passedTests: results.reduce((sum, result) => sum + (result.counts.passed || 0), 0),
      status: unchanged && results.every(result => result.status === 'passed') ? 'passed' : 'failed' }, scenarios: results };
  if (args[1]) {
    const output = path.resolve(args[1]); fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Report saved: ${output}\n`);
  } else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!unchanged) process.stderr.write('Source changed while the scorecard ran. Rerun against one stable source version.\n');
  if (report.summary.status !== 'passed') process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
