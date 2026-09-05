const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOfficeControlCatalog,
  findOfficeControl,
  normalizeOfficeFrontendPath,
  validateOfficeControlExecution,
} = require('./office-controls');

test('Office exposes only allowlisted controls and known sources', () => {
  const catalog = buildOfficeControlCatalog([
    { id: 'reddit', label: 'Reddit' },
    { id: '../bad', label: 'Bad' },
    { id: 'reddit', label: 'Duplicate' },
  ]);
  assert.ok(catalog.some((control) => control.id === 'feed.refresh-all'));
  assert.ok(catalog.some((control) => control.id === 'runtime.clean-stale-caches'));
  assert.ok(catalog.some((control) => control.id === 'source.refresh.reddit'));
  assert.equal(catalog.some((control) => control.id.includes('../bad')), false);
  assert.equal(catalog.filter((control) => control.id === 'source.refresh.reddit').length, 1);
  assert.equal(findOfficeControl('SOURCE.REFRESH.REDDIT', [{ id: 'reddit' }]).sourceId, 'reddit');
  assert.equal(findOfficeControl('shell.exec', [{ id: 'reddit' }]), null);
});

test('frontend commits stay inside existing frontend source roots', () => {
  assert.equal(normalizeOfficeFrontendPath('web', 'web/src/App.jsx'), 'web/src/App.jsx');
  assert.equal(normalizeOfficeFrontendPath('web', './web/public/robots.txt'), 'web/public/robots.txt');
  assert.equal(normalizeOfficeFrontendPath('mobile', 'mobile/screens/HomeScreen.js'), 'mobile/screens/HomeScreen.js');
  assert.equal(normalizeOfficeFrontendPath('office', 'office/src/Controls.jsx'), 'office/src/Controls.jsx');
  assert.equal(normalizeOfficeFrontendPath('office', 'office/index.html'), 'office/index.html');
  assert.equal(normalizeOfficeFrontendPath('web', 'backend/index.js'), null);
  assert.equal(normalizeOfficeFrontendPath('office', 'backend/index.js'), null);
  assert.equal(normalizeOfficeFrontendPath('mobile', 'mobile/app.json'), null);
  assert.equal(normalizeOfficeFrontendPath('web', 'web/src/../../backend/index.js'), null);
  assert.equal(normalizeOfficeFrontendPath('web', 'web/src/logo.png'), null);
});

test('Office and public web frontend controls are both allowlisted', () => {
  assert.equal(findOfficeControl('commit.web-frontend')?.frontendTarget, 'web');
  assert.equal(findOfficeControl('commit.office-frontend')?.frontendTarget, 'office');
  assert.equal(findOfficeControl('deploy.frontends')?.requiresConfirmation, true);
});

test('high-impact controls require explicit confirmation', () => {
  const sourceList = [{ id: 'reddit', label: 'Reddit' }];
  const deploy = findOfficeControl('deploy.web', sourceList);
  assert.equal(validateOfficeControlExecution(deploy, {}).valid, false);
  assert.deepEqual(
    validateOfficeControlExecution(deploy, { contextId: 'web-release', contextLabel: 'Ship homepage', confirmed: true }),
    { valid: true, contextId: 'web-release', contextLabel: 'Ship homepage' },
  );
});

test('stale cache cleanup runs on both backend roles and requires confirmation', () => {
  const cleanup = findOfficeControl('runtime.clean-stale-caches');
  assert.equal(cleanup?.target, 'both');
  assert.equal(cleanup?.requiresConfirmation, true);
  assert.equal(validateOfficeControlExecution(cleanup, {}).valid, false);
});

test('low-impact controls receive a default audit context', () => {
  const health = findOfficeControl('health.website');
  assert.equal(validateOfficeControlExecution(health, null).valid, false);
  assert.deepEqual(
    validateOfficeControlExecution(health, {}),
    { valid: true, contextId: 'office-controls', contextLabel: 'Manual Office control' },
  );
});
