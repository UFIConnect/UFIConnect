'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDestination, routeTaskRequest, hasTaskObjective, pathAllowedForRoute, toolAllowedForRoute } = require('./office-ai-routing');
const all = { editCode: true, publish: true, deploy: true, operate: true };

test('destinations distinguish Office, hosted drafts, public web and AI upgrades from open-ended asks', () => {
  for (const [message, expected] of [
    ['Check the office controls and agent status.', 'office'], ['Update the local website heading.', 'hosted-web'],
    ['Fix the localhost preview.', 'hosted-web'], ['Create a hosted website draft.', 'hosted-web'], ['Update the public website button.', 'public-web'],
    ['Deploy the website after its checks pass.', 'public-web'], ['Upgrade yourself with better memory.', 'self-update'],
    ['Improve uficonnect.ai capabilities.', 'self-update'], ['Write a poem about stars.', 'general'],
    ['Update the heading.', 'general'], ['Do not publish the website; explain the code.', 'general'],
  ]) assert.equal(classifyDestination(message).target, expected, message);
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
