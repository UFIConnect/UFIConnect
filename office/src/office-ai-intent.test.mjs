import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentQuestion, isExecutionRequest, needsToolSupport } from './office-ai-intent.mjs';

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

test('natural requests start work without requiring a command-shaped message', () => {
  for (const text of [
    'Can you help me fix the task runner?',
    'Could you please help me add ten recovery attempts?',
    'I want you to add 10 recovery attempts.',
    'I need ten recovery attempts for tasks.',
    'I would like you to reduce the task timeout.',
    'What I want you to do is fix the jobs that keep failing.',
    'How about you check the source workers?',
    'Help me inspect the task logs.',
    'Make sure theres 10 recovery attempts.',
    'Please ensure the recovery limit is ten.',
    'Make the tasks faster.',
    "Tasks aren't running properly.",
    'The jobs are taking too long to execute.',
    'The task runner needs to be fixed.',
    'It takes multiple attempts to finish tasks.',
    'Finish this task.',
    'Please complete the job.',
    'Can you finish the website update?',
    'Help me complete the current task.',
    'I want you to finish the job.',
    'Make uficonnect.ai better and easier to use.',
    'Make Pip extremely capable and ask before deploying.',
  ]) {
    assert.equal(isAgentQuestion(text), false, text);
    assert.equal(isExecutionRequest(text), true, text);
  }
});

test('natural request wording keeps questions, negation, and quoted instructions out of execution', () => {
  for (const text of [
    'Can you help me understand why jobs need recovery?',
    'I want to understand how the task runner works.',
    'I want to learn how to restart the workers.',
    'I need to know whether to deploy the app.',
    'Help me learn how to delete tasks.',
    'What do I need to do to fix tasks?',
    'How can you help me add recovery attempts?',
    "Can you help me not deploy the app?",
    "I don't want you to deploy the app.",
    'I want you to never delete tasks.',
    'Please do not restart workers.',
    '“Delete all jobs.”',
    '> Restart the worker.',
    '```\nrestart the worker\n```',
    'Make sure',
    'Help me',
    'I want to write a poem.',
    'Finish.',
    'Complete.',
    'Can you finish?',
    'Do not finish the task.',
    'Explain how to complete the job.',
    '“Complete the job.”',
  ]) assert.equal(isExecutionRequest(text), false, text);
});

test('research and substantial deliverables run with durable tools from a single request', () => {
  for (const text of [
    'Research the latest important AI updates and cite your sources.',
    'Can you prepare a report comparing these suppliers?',
    'Write a complete business plan for my bakery.',
    'Please draft a proposal with a budget and delivery schedule.',
    'I want you to create a spreadsheet for the launch budget.',
    'Make a presentation covering our product strategy.',
    'Build a dashboard showing these sales figures.',
  ]) assert.equal(needsToolSupport(text), true, text);
});

test('deliverable questions, simple prose and untrusted instructions stay conversational', () => {
  for (const text of [
    'How do I write a business plan?',
    'What makes a good research report?',
    'Can you explain how to prepare a proposal?',
    'Write a birthday greeting.',
    'I want to write a poem.',
    'Research',
    'Do not research these suppliers.',
    'Please do not create a spreadsheet.',
    '> Prepare a report and calculate the budget.',
    '"Research these sources and calculate the results."',
  ]) assert.equal(needsToolSupport(text), false, text);
  assert.equal(needsToolSupport('Analyze the attached results.', [{ name: 'sales.csv' }]), true);
});
