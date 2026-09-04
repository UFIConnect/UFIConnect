const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOfficeControlCatalog,
  findOfficeControl,
  normalizeOfficeFrontendPath,
  validateOfficeControlExecution,
} = require('./office-controls');

test('Decision Foundry exposes only allowlisted controls and known sources', () => {
  const catalog = buildOfficeControlCatalog([
    { id: 'reddit', label: 'Reddit' },
    { id: '../bad', label: 'Bad' },
    { id: 'reddit', label: 'Duplicate' },
  ]);
  assert.ok(catalog.some((control) => control.id === 'feed.refresh-all'));
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
  assert.equal(normalizeOfficeFrontendPath('web', 'backend/index.js'), null);
  assert.equal(normalizeOfficeFrontendPath('mobile', 'mobile/app.json'), null);
  assert.equal(normalizeOfficeFrontendPath('web', 'web/src/../../backend/index.js'), null);
  assert.equal(normalizeOfficeFrontendPath('web', 'web/src/logo.png'), null);
});

test('high-impact controls require confirmation and a linked decision', () => {
  const sourceList = [{ id: 'reddit', label: 'Reddit' }];
  const deploy = findOfficeControl('deploy.web', sourceList);
  assert.equal(validateOfficeControlExecution(deploy, {}).valid, false);
  assert.equal(validateOfficeControlExecution(deploy, { decisionId: 'd1' }).valid, false);
  assert.deepEqual(
    validateOfficeControlExecution(deploy, { decisionId: 'd1', decisionTitle: 'Ship homepage', confirmed: true }),
    { valid: true, decisionId: 'd1', decisionTitle: 'Ship homepage' },
  );
});

test('low-impact controls still require an auditable decision record', () => {
  const health = findOfficeControl('health.website');
  assert.equal(validateOfficeControlExecution(health, null).valid, false);
  assert.equal(validateOfficeControlExecution(health, { decisionId: '' }).valid, false);
  assert.equal(validateOfficeControlExecution(health, { decisionId: 'health-check' }).valid, true);
});
