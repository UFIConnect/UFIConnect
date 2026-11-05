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

test('concrete repository and Office data reads use tools while explanations stay conversational', () => {
  for (const text of ['Can you read backend/index.js?', 'Read backend/index.js and report what it does.', 'Search the repository for office_token.', 'Could you list the source files?', 'Please inspect package.json.', 'Find the saved functions.', 'Open the transfer queue.', 'Show me the services.', 'List my connections.', 'Search memory for the last deployment.', 'Use the tax function with this input.', 'Can you call the saved function?', 'Invoke the compound-growth function.']) {
    assert.equal(isAgentQuestion(text), false, text);
    assert.equal(isExecutionRequest(text), true, text);
  }
  for (const text of ['How do I read backend/index.js?', 'Explain how to search the repository.', 'What does package.json do?', 'Can you explain the service logs?', 'Do not read backend/index.js.', 'Show me a poem.', 'Can you read music?', 'Find a birthday greeting.', 'How do I invoke this function?', 'Explain how to call a function.', 'Search the web for vacation ideas.']) assert.equal(isExecutionRequest(text), false, text);
});
