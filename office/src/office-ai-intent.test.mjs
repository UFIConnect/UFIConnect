import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentQuestion, isExecutionRequest } from './office-ai-intent.mjs';

test('questions and idle messages in agents do not become execution requests', () => {
  for (const text of ['Hi!', 'Hello there', 'Hi Pip', 'Good morning', 'What can you do?', 'Start task', 'Do the task', 'Do nothing', 'How do upgrades work?', 'Can you explain the failure?', 'Explain why this code fails.', 'Should I deploy this?']) assert.equal(isAgentQuestion(text), true, text);
  for (const text of ['Fix the broken button.', 'Could you update the heading?', 'Write a plan for the release.', 'Upgrade Pip with better memory.', 'Can you enable configured agents?', 'Could you optimize the source workers?', 'Would you transfer the staged posts?']) assert.equal(isAgentQuestion(text), false, text);
});

test('the main chat runs action requests and keeps questions conversational', () => {
  for (const text of ['Fix the broken button.', 'Could you update the homepage and deploy it?', 'Improve Pip memory.', 'The login is not working.', 'Enable configured agents.', 'Activate source workers.', 'Can you enable configured agents?', 'Optimize the pipeline.', 'Sync the sources.', 'Transfer the staged posts.', 'Drain the queue.', 'Execute the checks.']) assert.equal(isExecutionRequest(text), true, text);
  for (const text of ['Hello Pip', 'What can you do?', 'How do I fix this?', 'Explain the deployment.', 'Do not deploy; explain the code.', 'How do I enable configured agents?', 'What happens when I drain the queue?', 'Explain how to activate source workers.', 'Do not disable the agents.']) assert.equal(isExecutionRequest(text), false, text);
});
