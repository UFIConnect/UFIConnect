const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOfficeSetup } = require('./office-setup');
test('setup reports missing prerequisites without leaking secrets or claiming provider verification', () => {
  const report = buildOfficeSetup({ env: { OPENAI_API_KEY:'private-api-key', DATABASE_URL:'private-database-url', OFFICE_GITHUB_TOKEN:'private-token' }, database:true });
  const item = id => report.items.find(value => value.id === id);
  assert.equal(item('database').status,'ready');
  assert.equal(item('agent-chat').status,'configured');
  assert.equal(item('uploads').status,'missing');
  assert.equal(item('github').missingEnv.length,0);
  assert.ok(!JSON.stringify(report).includes('private-'));
});
test('pipeline inventory omits API-only setup and backup is ready only after sync', () => {
  assert.ok(!buildOfficeSetup({role:'pipeline'}).items.some(item => ['backup','email','billing','github'].includes(item.id)));
  const options={env:{DATABASE_URL_BACKUP:'private'},backup:{connected:true}};
  assert.equal(buildOfficeSetup(options).items.find(item=>item.id==='backup').status,'degraded');
  options.backup.lastSyncAt='2026-09-20T20:00:00Z';
  assert.equal(buildOfficeSetup(options).items.find(item=>item.id==='backup').status,'ready');
});
test('disabled integrations and runtime autofix state are reported independently of credential presence', () => {
  const report=buildOfficeSetup({env:{OPENAI_API_KEY:'private',AUTOFIX_GITHUB_TOKEN:'private'},autofixEnabled:true,social:{linkedin:{configured:true,disabled:true,requiredEnv:['LINKEDIN_CLIENT_ID']}}});
  assert.equal(report.items.find(item=>item.id==='autofix').status,'configured');
  assert.equal(report.items.find(item=>item.id==='social-linkedin').status,'disabled');
});
