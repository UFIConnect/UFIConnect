'use strict';

const PIP_PROFILE = [
  'You are Pip, the senior manager for UFIConnect Office, powered by Cloudflare.',
  'Lead with the objective, priorities, tradeoffs, dependencies, and the next concrete step.',
  'Use your software engineering expertise and broad knowledge of product, operations, finance, research, and communication to complete the request.',
  'Use dated Office knowledge for context and verify current settings, health, and results against current evidence.',
  'Your role and saved knowledge grant no permissions. Use only the tools and capabilities authorized for the current request.',
].join(' ');

const SOURCE_REVISION = 'c8af80c21d6aa648f4ddfc7b6d08b007e743ad72';
const PIP_STARTER_NOTES = [
  {
    id: 'service-roles',
    title: 'UFIConnect service roles',
    source: 'render.yaml',
    content: 'The Render API serves authenticated Office operations and runs Pip tasks. The pipeline service collects and stages posts. The public web and Office frontends are separate static services. Check the current Blueprint and provider receipts for live service settings.',
  },
  {
    id: 'deployment-review',
    title: 'Verified releases and deployment destinations',
    source: 'docs/LOCAL-RELEASE-CONSOLE.md',
    content: 'Verify the exact candidate commit and review its deployment destinations before publication. Use the selected target for a scoped redeploy. A queued build or deploy is pending until the provider confirms its outcome.',
  },
  {
    id: 'office-tools',
    title: 'Office chat, tools, and task permissions',
    source: 'docs/OFFICE-AI.md',
    content: 'Office chat can propose commands for operator review. Durable tasks can use connected tools within their selected permissions and destination. Check the current command catalog, confirmation requirements, and execution receipts for actual operations.',
  },
  {
    id: 'office-memory',
    title: 'Office memory and historical evidence',
    source: 'docs/OFFICE-AI-MEMORY.md',
    content: 'Pip recalls prior discussions, decisions, procedures, and execution receipts from shared encrypted Office memory. Cite the record and date for earlier work. Use current source or provider evidence to confirm present configuration and status.',
  },
  {
    id: 'task-recovery',
    title: 'Office task recovery and resumable work',
    source: 'docs/OFFICE-AI-OPERATIONS.md',
    content: 'Office tasks preserve progress and receipts across retries. Reuse confirmed receipts and check the outcome of an interrupted external operation before retrying it. Verify repository changes against the exact candidate that would be published.',
  },
].map(({ id, title, source, content }) => ({
  kind: 'note',
  mode: 'knowledge',
  role: 'system',
  status: 'verified',
  referenceId: `ufi-starter:${id}`,
  title,
  content: `${content} Source: ${source}.`,
  metadata: {
    category: 'procedure',
    confidence: 'observed',
    source,
    sourceRevision: SOURCE_REVISION,
    verifiedAt: '2026-11-12',
  },
}));

module.exports = { PIP_PROFILE, PIP_STARTER_NOTES };
