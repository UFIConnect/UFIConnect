import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = file => parse(fs.readFileSync(path.join(root, file), 'utf8'));
const blueprint = load('render.yaml');
for (const service of blueprint.services) {
  assert.equal(service.autoDeployTrigger, 'off', `${service.name}: automatic deploys must be owned by the verified-commit hook workflow`);
  assert.ok(service.buildCommand.startsWith('npm ci'), `${service.name}: use locked dependencies`);
  const keys = service.envVars.map(variable => variable.key);
  assert.equal(new Set(keys).size, keys.length, `${service.name}: duplicate environment setting`);
  if (service.runtime === 'static') {
    const header = name => service.headers.find(value => value.name === name)?.value;
    assert.match(header('Content-Security-Policy'), /script-src 'self'/);
    assert.doesNotMatch(header('Content-Security-Policy').split(';').find(value => value.trim().startsWith('script-src')), /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(header('Content-Security-Policy'), /google-analytics|analytics\.google/, 'Analytics collection remains in the separate API bridge');
    if (service.name === 'uficonnect-web') {
      assert.match(header('Content-Security-Policy'), /https:\/\/www\.googletagmanager\.com/, 'The public homepage can load the consented Ads tag');
      // Per-document meta policies restrict Ads to the homepage. The browser
      // audit verifies login, Vault and the dynamic app shell remain strict.
    } else assert.doesNotMatch(header('Content-Security-Policy'), /googletagmanager|googleadservices/, 'Office does not load advertising');
    assert.match(header('Content-Security-Policy'), /(?:^|;\s*)script-src-attr 'none'(?:;|$)/, 'Inline event handlers must remain blocked');
    assert.equal(header('X-XSS-Protection'), '0', 'Use CSP and explicitly disable the obsolete, unsafe browser XSS filter');
    assert.equal(header('Referrer-Policy'), 'no-referrer');
  } else {
    assert.ok(keys.includes('OAUTH_TOKEN_ENCRYPTION_KEY'), `${service.name}: encrypted credential key must be declared`);
    const dbUrl = service.envVars.find(variable => variable.key === 'DATABASE_URL');
    assert.equal(dbUrl?.sync, false, `${service.name}: explicitly configure a verified external database URL`);
    assert.equal(dbUrl?.fromDatabase, undefined, `${service.name}: Render internal connection strings do not support verified TLS`);
    assert.equal(service.envVars.find(variable => variable.key === 'DATABASE_SSL_MODE')?.value, 'verify-full');
  }
}
for (const file of ['.github/workflows/deploy-render.yml', '.github/workflows/deploy-pages.yml']) {
  const workflow = load(file);
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Verify UFIconnect']);
  assert.equal(workflow.on.push, undefined, 'Deployment must not bypass verification');
  assert.equal(workflow.concurrency?.['cancel-in-progress'], false, 'Serialize deploys without allowing a late old run to cancel a new one');
  for (const job of Object.values(workflow.jobs)) {
    assert.match(job.if, /conclusion == 'success'/);
    assert.match(job.if, /head_repository.full_name == github.repository/);
    const commands = job.steps.map(step => step.run || '').join('\n');
    assert.ok(commands.includes('/git/ref/heads/main'), 'Deploys must check the latest main commit');
    assert.ok(commands.includes('latest_sha') && commands.includes('VERIFIED_SHA'), 'Deploys must reject superseded commits');
  }
}
const renderDeployment = load('.github/workflows/deploy-render.yml');
assert.equal(renderDeployment.permissions.actions, 'read', 'Manual deployment verification needs read-only Actions access');
assert.deepEqual(renderDeployment.on.workflow_dispatch.inputs.target.options, [
  'all', 'frontends', 'web', 'office', 'api', 'pipeline',
]);
const renderJob = renderDeployment.jobs['deploy-render'];
assert.match(renderJob.if, /workflow_dispatch/);
assert.match(renderJob.if, /refs\/heads\/main/);
const renderCommands = renderJob.steps.map(step => step.run || '').join('\n');
for (const required of ['actions/workflows/verify.yml/runs', 'head_sha=${VERIFIED_SHA}', '.event == "push"', '.conclusion == "success"']) {
  assert.ok(renderCommands.includes(required), `Manual Render deployment must verify: ${required}`);
}
const verification = load('.github/workflows/verify.yml');
assert.ok(verification.jobs.native, 'Native verification must gate releases alongside the web checks');
const nativeSteps = verification.jobs.native.steps.map(step => step.run || '').join('\n');
for (const required of ['npm ci --prefix mobile', 'npm run test:security', 'npm run audit:security', 'npm run doctor', 'npm run export', 'npm run test:export', 'npm run test:analytics']) {
  assert.ok(nativeSteps.includes(required), `Missing native verification: ${required}`);
}
const mobileRelease = load('.github/workflows/mobile-release.yml');
const releaseSteps = mobileRelease.jobs.build.steps;
const buildIndex = releaseSteps.findIndex(step => step.run?.startsWith('eas build'));
assert.ok(buildIndex >= 0, 'Mobile release must queue an EAS build');
const precedingSteps = releaseSteps.slice(0, buildIndex).map(step => step.run || '').join('\n');
for (const required of ['npm ci', 'npm run test:security', 'npm run audit:security', 'npm run doctor', 'npm run export', 'npm run test:export', 'npm run test:analytics']) {
  assert.ok(precedingSteps.includes(required), `Mobile build must first pass: ${required}`);
}
const mobilePackage = JSON.parse(fs.readFileSync(path.join(root, 'mobile/package.json'), 'utf8'));
assert.equal(mobilePackage.scripts.postinstall, 'node security/dependencyPatches.cjs', 'Locked installs must apply reviewed security backports');
assert.equal(mobilePackage.scripts['audit:security'], 'node --test security/dependencyBackports.test.js && node security/dependencyAudit.cjs', 'Audit must require attack regressions before scoped advisory evaluation');
load('.github/dependabot.yml');
for (const file of ['docker-compose.yml', 'docker-compose.lb.yml']) {
  const compose = load(file);
  assert.equal(compose.services.db.ports, undefined, `${file}: the local database must not expose a host port`);
  assert.ok(compose.services.db.environment.POSTGRES_PASSWORD.includes(':?'), `${file}: require a database secret`);
  for (const [name, service] of Object.entries(compose.services)) {
    for (const port of service.ports || []) assert.match(port, /^127\.0\.0\.1:/, `${file}: local examples must bind only loopback`);
    if (!name.startsWith('backend')) continue;
    assert.equal(service.ports, undefined, `${file}: backend ports must remain behind the trusted proxies`);
    for (const key of ['JWT_SECRET', 'OAUTH_TOKEN_ENCRYPTION_KEY']) {
      assert.ok(service.environment[key]?.includes(':?'), `${file}: require ${key}`);
    }
    assert.equal(service.environment.DATABASE_SSL_MODE, 'disable');
    assert.equal(service.environment.DATABASE_ALLOW_PLAINTEXT_INTERNAL, 'true', `${file}: local private-network TLS exemption must be explicit`);
    assert.equal(service.environment.TRUST_PROXY, file.endsWith('.lb.yml') ? '2' : '1');
  }
}
console.log('PASS: deployment YAML parses; encrypted credentials, CSP, locked installs and verification gates configured');
