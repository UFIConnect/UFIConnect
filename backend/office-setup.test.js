const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildOfficeSetup, getOfficeSourceReadiness } = require('./office-setup');

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
  assert.equal(buildOfficeSetup({env}).items.find(v=>v.id==='login-apple').status,'missing', 'An invalid signing key cannot enable Apple sign-in');
  env.APPLE_PRIVATE_KEY=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'});
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
test('setup uses the same dedicated Google callback selection as sign-in with a partial pair', () => {
  const item = buildOfficeSetup({ env: { GOOGLE_CLIENT_SECRET: 'private-secret', YOUTUBE_CLIENT_ID: 'private-fallback-id', YOUTUBE_CLIENT_SECRET: 'private-fallback-secret' } }).items.find(value => value.id === 'login-google');
  assert.equal(item.status, 'missing');
  assert.deepEqual(item.requiredEnv, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  assert.deepEqual(item.missingEnv, ['GOOGLE_CLIENT_ID']);
  assert.match(item.detail, /https:\/\/api\.uficonnect\.org\/auth\/providers\/google\/callback/);
  assert.ok(!JSON.stringify(item).includes('private-'));
});

test('source setup shows the exact configured redirect URI without exposing credential values', () => {
  const callbackUrl = 'https://api.uficonnect.org/auth/social/linkedin/callback';
  const item = buildOfficeSetup({ social: { linkedin: { configured: false, requiredEnv: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], callbackUrl } } }).items.find(value => value.id === 'social-linkedin');
  assert.equal(item.status, 'missing');
  assert.ok(item.detail.includes(callbackUrl));
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

test('public collector prerequisites use actual worker keys and remain separate from member OAuth', () => {
  const env = { TWITTER_CLIENT_ID: 'private-client', TWITTER_CLIENT_SECRET: 'private-secret', LINKEDIN_CLIENT_ID: 'private-client', LINKEDIN_CLIENT_SECRET: 'private-secret', FACEBOOK_APP_ID: 'private-client', FACEBOOK_APP_SECRET: 'private-secret', USAJOBS_API_KEY: 'private-search-key', USAJOBS_EMAIL: 'private-wrong-alias' };
  const pipeline = buildOfficeSetup({ env, role: 'pipeline' });
  const item = id => pipeline.items.find(value => value.id === `source-${id}`);
  assert.deepEqual(item('twitter').missingEnv, ['TWITTER_BEARER_TOKEN']);
  assert.deepEqual(item('linkedin').missingEnv, ['LINKEDIN_TOKEN']);
  assert.deepEqual(item('facebook').missingEnv, ['FACEBOOK_TOKEN']);
  assert.deepEqual(item('reddit').missingEnv, ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET']);
  assert.deepEqual(item('usajobs').missingEnv, ['USAJOBS_USER_AGENT']);
  assert.ok(!buildOfficeSetup({ env }).items.some(value => value.id.startsWith('source-')));
  assert.equal(getOfficeSourceReadiness('reddit', { REDDIT_CLIENT_ID: 'private', REDDIT_CLIENT_SECRET: '  ' }).configured, false);
  assert.equal(getOfficeSourceReadiness('usajobs', { USAJOBS_API_KEY: 'private', USAJOBS_USER_AGENT: 'private-email' }).configured, true);
  assert.equal(getOfficeSourceReadiness('hn', {}).configured, true, 'A public collector without key requirements can use its existing worker');
  assert.ok(!JSON.stringify(pipeline).includes('private-'));
});

test('source setup requires configured credentials and actual post observations before reporting ready', () => {
  const sourceWorkers = { twitter: { lastSuccess: 1, postCount: 25 }, twitch: { lastSuccess: 1, postCount: 0 }, usajobs: { lastSuccess: 1, postCount: 25, consecutiveErrors: 1 } };
  const env = { TWITCH_CLIENT_ID: 'private-id', TWITCH_CLIENT_SECRET: 'private-secret', USAJOBS_API_KEY: 'private-key', USAJOBS_USER_AGENT: 'private-email' };
  const options = { role: 'pipeline', env, sourceWorkers };
  let items = buildOfficeSetup(options).items;
  assert.equal(items.find(item => item.id === 'source-twitter').status, 'missing', 'An empty token worker cannot claim readiness from a successful empty return');
  assert.equal(items.find(item => item.id === 'twitch').status, 'configured');
  assert.equal(items.find(item => item.id === 'source-usajobs').status, 'degraded');
  env.TWITTER_BEARER_TOKEN = 'private-token';
  sourceWorkers.twitch.postCount = 10;
  items = buildOfficeSetup(options).items;
  assert.equal(items.find(item => item.id === 'source-twitter').status, 'ready');
  assert.equal(items.find(item => item.id === 'twitch').status, 'ready');
  sourceWorkers.twitter.paused = true;
  sourceWorkers.twitter.lastError = 'private-provider-error';
  const report = buildOfficeSetup(options);
  assert.equal(report.items.find(item => item.id === 'source-twitter').status, 'degraded');
  assert.ok(!JSON.stringify(report).includes('private-'));
});

test('AI action setup exposes safe capability flags independently of paid explanations', () => {
  const env = { OFFICE_TOKEN: 'private-token', DATABASE_URL: 'private-url', OFFICE_CHAT_OPENAI_MODEL: 'private-model' };
  const report = buildOfficeSetup({ env, database: true });
  const actions = report.items.find(item => item.id === 'agent-actions');
  const explanations = report.items.find(item => item.id === 'agent-chat');
  assert.equal(actions.status, 'ready');
  assert.equal(actions.capabilities.actionControlsConfigured, true);
  assert.equal(actions.capabilities.explanationKeyConfigured, false);
  assert.equal(actions.capabilities.modelConfigured, true);
  assert.equal(explanations.status, 'missing');
  assert.equal(explanations.capabilities.usesDefaultModel, false);
  assert.equal(buildOfficeSetup({ env, database: false }).items.find(item => item.id === 'agent-actions').status, 'degraded');
  assert.ok(!buildOfficeSetup({ env, role: 'pipeline' }).items.some(item => item.id === 'agent-actions'));
  assert.ok(!JSON.stringify(report).includes('private-'));
});
