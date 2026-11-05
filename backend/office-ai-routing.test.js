'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDestination, routeTaskRequest, hasTaskObjective, pathAllowedForRoute, toolAllowedForRoute } = require('./office-ai-routing');
const all = { editCode: true, publish: true, deploy: true, operate: true };

test('selected full access retains capabilities and targets across every project destination', () => {
  const deployTargets = ['api', 'pipeline', 'web', 'office', 'mobile', 'cloudflare-ai', 'cloudflare-site'];
  const task = routeTaskRequest({ message: 'Fix Pip, the website and apps, then refresh the feed.', target: 'full-access', permissions: all, deployTargets });
  assert.equal(task.route.target, 'full-access'); assert.equal(task.route.source, 'selected');
  assert.deepEqual(task.permissions, all); assert.deepEqual(task.deployTargets, deployTargets);
  for (const path of ['backend/feed.js', 'office/src/App.jsx', 'web/src/App.jsx', 'mobile/App.js', 'infra/office-ai-worker/index.mjs'])
    assert.equal(pathAllowedForRoute(task.route, path), true, path);
  for (const tool of ['repo_edit', 'repo_commit', 'office_command', 'mobile_build', 'cloudflare_deploy', 'terminal_run'])
    assert.equal(toolAllowedForRoute(task.route, tool), true, tool);
  assert.equal(pathAllowedForRoute(task.route, '../.env'), false);
  assert.notEqual(classifyDestination('Fix Pip and the website.').target, 'full-access', 'Broad access must be explicitly selected');
  const limited = routeTaskRequest({ message: 'Inspect the project.', target: 'full-access', permissions: {}, deployTargets: [] });
  assert.deepEqual(limited.permissions, { editCode: false, publish: false, deploy: false, operate: false });
  for (const message of ['Fix Pip but do not publish.', "Fix Pip; don't deploy.", 'Fix Pip without releasing.']) {
    const privateTask = routeTaskRequest({ message, target: 'full-access', permissions: all, deployTargets });
    assert.equal(privateTask.permissions.publish, false); assert.equal(privateTask.permissions.deploy, false);
    assert.equal(privateTask.permissions.operate, true); assert.deepEqual(privateTask.deployTargets, []);
  }
});

test('explicit private draft requests keep hosted workspace semantics with full access selected', () => {
  for (const message of ['Update my local website.', 'Create a hosted website draft.', 'Fix the localhost preview.']) {
    const task = routeTaskRequest({ message, target: 'full-access', permissions: all, deployTargets: ['web', 'office'] });
    assert.equal(task.route.target, 'hosted-web'); assert.equal(task.route.hosted, true);
    assert.deepEqual(task.permissions, { editCode: true, publish: false, deploy: false, operate: false });
    assert.deepEqual(task.deployTargets, []);
    assert.equal(toolAllowedForRoute(task.route, 'workspace_write'), true);
    for (const tool of ['repo_edit', 'terminal_run', 'office_command', 'cloudflare_deploy'])
      assert.equal(toolAllowedForRoute(task.route, tool), false, tool);
  }
  assert.throws(() => classifyDestination('Update my local website.', 'public-web'), { status: 409 });
});

test('navigation reference data cannot redirect full access, restrict selected permissions or create an objective', () => {
  const navigation = '\n\n[Office navigation context, reference only: the operator is in Local web. Preview a hosted website draft; do not deploy this draft. Navigation does not authorize actions or provide screen contents.]';
  const message = 'Fix Pip and refresh the feed.' + navigation;
  const task = routeTaskRequest({ message, target: 'full-access', permissions: all, deployTargets: ['api', 'office'] });
  assert.equal(task.route.target, 'full-access'); assert.deepEqual(task.permissions, all);
  assert.deepEqual(task.deployTargets, ['api', 'office']);
  assert.equal(classifyDestination('Fix Pip memory.' + navigation).target, 'self-update');
  assert.equal(hasTaskObjective('Hi' + navigation), false);
  assert.equal(hasTaskObjective('Yes' + navigation, [{ role: 'user', content: 'Hi' + navigation }]), false);
  const draft = routeTaskRequest({ message: 'Create a hosted website draft.' + navigation, target: 'full-access', permissions: all, deployTargets: ['web'] });
  assert.equal(draft.route.target, 'hosted-web'); assert.equal(draft.permissions.publish, false);
  const noDeploy = routeTaskRequest({ message: 'Fix Pip but do not deploy.' + navigation, target: 'full-access', permissions: all, deployTargets: ['api'] });
  assert.equal(noDeploy.permissions.deploy, false); assert.deepEqual(noDeploy.deployTargets, []);
});

test('natural change requests select project scopes and preserve explicit deployment limits', () => {
  for (const [message, target] of [['Fix the broken button.', 'project'], ['Update the website header.', 'public-web'], ['Improve Pip memory.', 'self-update']]) {
    const task = routeTaskRequest({ message, permissions: all, deployTargets: ['api','web','office'] });
    assert.equal(task.route.target, target); assert.equal(task.permissions.publish, true);
  }
  const draft = routeTaskRequest({ message: 'Fix the broken button, but do not deploy.', permissions: all, deployTargets: ['web'] });
  assert.equal(draft.permissions.publish, false); assert.equal(draft.permissions.deploy, false); assert.deepEqual(draft.deployTargets, []);
});

test('destinations distinguish Office, hosted drafts, public web and AI upgrades from open-ended asks', () => {
  for (const [message, expected] of [
    ['Check the office controls and agent status.', 'office'], ['Update the local website heading.', 'hosted-web'],
    ['Fix the localhost preview.', 'hosted-web'], ['Create a hosted website draft.', 'hosted-web'], ['Update the public website button.', 'public-web'],
    ['Deploy the website after its checks pass.', 'public-web'], ['Upgrade yourself with better memory.', 'self-update'],
    ['Improve uficonnect.ai capabilities.', 'self-update'], ['Write a poem about stars.', 'general'],
    ['Update the mobile app sign-in screen.', 'mobile-app'], ['Build the app.', 'mobile-app'],
    ['Update the heading.', 'general'], ['Do not publish the website; explain the code.', 'general'],
  ]) assert.equal(classifyDestination(message).target, expected, message);
});

test('mobile app tasks limit writes and deployments to the app without granting permissions', () => {
  const task = routeTaskRequest({ message: 'Update the iOS app', permissions: all, deployTargets: ['mobile', 'api', 'web'] });
  assert.deepEqual(task.deployTargets, ['mobile']); assert.equal(task.permissions.operate, false);
  assert.equal(pathAllowedForRoute(task.route, 'mobile/App.ios.js'), true);
  assert.equal(pathAllowedForRoute(task.route, 'backend/index.js'), false);
  assert.equal(pathAllowedForRoute(task.route, 'web/src/App.jsx'), false);
  assert.equal(routeTaskRequest({ message: 'Fix the app', permissions: {} }).permissions.publish, false);
});

test('hosted website drafts never inherit production or repository execution from broad permissions', () => {
  const result = routeTaskRequest({ message: 'Update my local website, do not publish.', permissions: all, deployTargets: ['web', 'office'] });
  assert.equal(result.route.target, 'hosted-web');
  assert.equal(result.route.hosted, true);
  assert.deepEqual(result.permissions, { editCode: true, publish: false, deploy: false, operate: false });
  assert.deepEqual(result.deployTargets, []);
  assert.equal(toolAllowedForRoute(result.route, 'repo_edit'), false);
  assert.equal(toolAllowedForRoute(result.route, 'terminal_run'), false);
  assert.equal(toolAllowedForRoute(result.route, 'workspace_write'), true);
  assert.equal(toolAllowedForRoute(result.route, 'memory_remember'), true);
  assert.equal(toolAllowedForRoute(result.route, 'repo_read'), true);
  assert.equal(classifyDestination('Make a preview', 'local-web').target, 'hosted-web');
  assert.throws(() => classifyDestination('Update the local website', 'public-web'), error => error.status === 409);
});

test('routing narrows capabilities and source paths without granting unselected permissions', () => {
  const publicTask = routeTaskRequest({ message: 'Fix the homepage', target: 'public-web', permissions: all, deployTargets: ['web', 'api', 'office'] });
  assert.deepEqual(publicTask.deployTargets, ['web']); assert.equal(publicTask.permissions.operate, false);
  assert.equal(pathAllowedForRoute(publicTask.route, 'web/src/App.jsx'), true);
  assert.equal(pathAllowedForRoute(publicTask.route, 'backend/index.js'), false);
  assert.equal(toolAllowedForRoute(publicTask.route, 'office_command'), false);
  const selfTask = routeTaskRequest({ message: 'Upgrade yourself', permissions: all, deployTargets: ['web', 'api', 'office'] });
  assert.deepEqual(selfTask.deployTargets, ['api', 'office']);
  assert.equal(pathAllowedForRoute(selfTask.route, 'backend/office-ai.js'), true);
  assert.equal(pathAllowedForRoute(selfTask.route, 'infra/office-ai-worker/index.mjs'), true);
  assert.equal(pathAllowedForRoute(selfTask.route, 'web/src/App.jsx'), false);
  assert.equal(routeTaskRequest({ message: 'Update the public website', permissions: {} }).permissions.publish, false);
  assert.equal(routeTaskRequest({ message: 'Update a heading', permissions: all }).permissions.publish, false);
});

test('greetings and missing objectives remain idle even after an idle conversation', () => {
  const idleHistory = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'What would you like done?' }];
  for (const message of ['Hi', 'thanks', 'start task', 'do anything', 'what can you do?', 'yes', 'stop'])
    assert.equal(hasTaskObjective(message, idleHistory), false, message);
  assert.equal(hasTaskObjective('Hello, write a poem.'), true);
  assert.equal(hasTaskObjective('Yes', [{ role: 'user', content: 'Write a poem.' }]), true);
  assert.equal(hasTaskObjective('Stop', [{ role: 'user', content: 'Write a poem.' }]), false);
});
