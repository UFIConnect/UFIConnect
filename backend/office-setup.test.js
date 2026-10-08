const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOfficeSetup } = require('./office-setup');

test('account login settings reuse Google credentials and accurately gate Apple and Twilio', () => {
  const env={YOUTUBE_CLIENT_ID:'private-google-id',YOUTUBE_CLIENT_SECRET:'private-google-secret',OAUTH_CALLBACK_BASE_URL:'https://api.uficonnect.org'};
  const items=buildOfficeSetup({env}).items;
  const item=id=>items.find(value=>value.id===id);
  assert.equal(item('login-google').status,'configured');
  assert.match(item('login-google').detail,/\/auth\/social\/youtube\/callback/);
  assert.equal(item('login-apple').status,'missing');
  assert.deepEqual(item('login-apple').missingEnv,['APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY']);
  assert.equal(item('login-phone').status,'missing');
  assert.ok(!JSON.stringify(items).includes('private-google'));
  Object.assign(env,{APPLE_CLIENT_ID:'private',APPLE_TEAM_ID:'private',APPLE_KEY_ID:'private',APPLE_PRIVATE_KEY:'private',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'private',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32)});
  const configured=buildOfficeSetup({env}).items;
  assert.equal(configured.find(v=>v.id==='login-apple').status,'configured');
  assert.equal(configured.find(v=>v.id==='login-phone').status,'configured');
  assert.ok(!buildOfficeSetup({env,role:'pipeline'}).items.some(v=>v.id.startsWith('login-')));
});
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

test('Resume Builder reports monthly and six-month price configuration independently', () => {
  const monthlyOnly = buildOfficeSetup({ env: { STRIPE_PRICE_ID_RESUME_BUILDER_MONTHLY: 'private-monthly-price' } });
  assert.equal(monthlyOnly.items.find(item => item.id === 'resume-monthly-billing').status, 'configured');
  assert.equal(monthlyOnly.items.find(item => item.id === 'resume-billing').status, 'missing');
  const sixMonthOnly = buildOfficeSetup({ env: { STRIPE_RESUME_BUILDER_PRICE_ID: 'private-six-month-price' } });
  assert.equal(sixMonthOnly.items.find(item => item.id === 'resume-monthly-billing').status, 'missing');
  assert.equal(sixMonthOnly.items.find(item => item.id === 'resume-billing').status, 'configured');
  assert.ok(!JSON.stringify([monthlyOnly, sixMonthOnly]).includes('private-'));
});
