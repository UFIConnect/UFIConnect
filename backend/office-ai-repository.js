'use strict';

const { createHash } = require('node:crypto');
const { createDeploymentObserver } = require('./office-ai-deployments');
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const VERIFICATION_PATHS = new Set(['.github/workflows/verify.yml', 'scripts/verify-release-reuse.mjs', 'scripts/verify-release-reuse.test.mjs']);
const blobSha = content => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const credentialMaterial = content => /-----BEGIN\s+(?:[A-Z ]*PRIVATE KEY)|\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{25,}|AKIA[A-Z0-9]{16})/.test(content);

function repositoryPath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9_.@/-]+$/.test(value)
    || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) return null;
  if (/(?:^|\/)(?:\.git|\.cache|node_modules|dist|build|coverage|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx|sqlite|db))$/i.test(value)
    || /(?:^|\/)(?:\.git|\.cache|node_modules|dist|build|coverage|credentials?|secrets?)\//i.test(value)) return null;
  if (!/^(?:(?:backend|web|office|mobile|infra|scripts|docs|tests)\/|\.github\/workflows\/|(?:README\.md|package(?:-lock)?\.json|render\.yaml|\.nvmrc|\.gitignore)$)/.test(value)) return null;
  return /\.(?:[cm]?js|jsx|ts|tsx|json|jsonc|css|html|md|txt|ya?ml|svg|xml|webmanifest|sh|ps1)$/.test(value)
    || /^(?:\.nvmrc|\.gitignore|(?:office|web)\/public\/_headers)$/.test(value) ? value : null;
}

function rangeOf(file, startLine = 1, endLine = startLine + 119) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine > 399) throw fail(400, 'Read between one and 400 lines at a time.');
  const lines = file.content.split('\n');
  const content = lines.slice(startLine - 1, endLine).join('\n');
  if (Buffer.byteLength(content) > 32000) throw fail(413, 'This section is too large. Read a smaller line range.');
  return { path: file.path, sha: file.sha, startLine, endLine: Math.min(endLine, lines.length), totalLines: lines.length, content, bytes: Buffer.byteLength(file.content) };
}

function applyRepositoryEdit(file, input) {
  if (!object(input) || Object.keys(input).some(key => !['path', 'expectedSha', 'edits', 'content'].includes(key)) || !repositoryPath(input.path)) throw fail(400, 'Choose an approved repository text file.');
  if (file && input.expectedSha !== file.sha || !file && input.expectedSha !== null) throw fail(409, 'The file changed or was not read at its current revision. Read it before editing.');
  let content = file?.content || '';
  if (!file) {
    if (typeof input.content !== 'string' || input.edits !== undefined) throw fail(400, 'New files require content and expectedSha:null.');
    content = input.content;
  } else {
    if (input.content !== undefined || !Array.isArray(input.edits) || !input.edits.length || input.edits.length > 20) throw fail(400, 'Existing files require up to 20 exact find/replace edits.');
    for (const edit of input.edits) {
      if (!object(edit) || Object.keys(edit).some(key => !['find', 'replace'].includes(key)) || typeof edit.find !== 'string' || !edit.find || typeof edit.replace !== 'string') throw fail(400, 'Each edit requires nonempty find text and replacement text.');
      const offset = content.indexOf(edit.find);
      if (offset < 0 || content.indexOf(edit.find, offset + 1) >= 0) throw fail(409, 'An edit did not match exactly one section. Read the current file and retry.');
      content = content.slice(0, offset) + edit.replace + content.slice(offset + edit.find.length);
    }
  }
  if (!content || content.includes('\0') || Buffer.byteLength(content) > 4 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(input)) > 160000) throw fail(413, 'The proposed edit exceeds task capacity.');
  if (content === file?.content) throw fail(400, 'The proposed edit makes no changes.');
  if (credentialMaterial(content)) throw fail(400, 'Credential material cannot be written through AI tasks.');
  return { path: input.path, content, sha: blobSha(content), originalSha: file?.originalSha ?? file?.sha ?? null,
    mode: file?.mode || '100644', before: file?.before ?? file?.content ?? '' };
}

function createOfficeAIRepository({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const owner = env.AUTOFIX_GITHUB_OWNER || 'UFIConnect';
  const name = (env.AUTOFIX_GITHUB_REPO || 'UFIConnect').replace(/^ufconnect$/i, 'UFIConnect');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) throw fail(503, 'Repository configuration is invalid.');
  const repository = `${owner}/${name}`, base = `https://api.github.com/repos/${repository}`;
  const token = () => env.OFFICE_GITHUB_TOKEN || env.AUTOFIX_GITHUB_TOKEN || '';
  // Only immutable, integrity-checked source is cached. Bound both entry count
  // and memory; a connection change must discard previously authorized data.
  const trees = new Map(), blobs = new Map();
  let cachedToken = token(), treeBytes = 0, blobBytes = 0;
  function sourceCache(signal) {
    signal?.throwIfAborted();
    if (cachedToken !== token()) {
      trees.clear(); blobs.clear(); treeBytes = 0; blobBytes = 0; cachedToken = token();
    }
  }
  function cached(cache, key) {
    const value = cache.get(key);
    if (value) { cache.delete(key); cache.set(key, value); }
    return value;
  }
  async function concurrent(items, worker) {
    const results = [];
    for (let start = 0; start < items.length; start += 4) {
      const batch = await Promise.allSettled(items.slice(start, start + 4).map(worker));
      const failed = batch.find(item => item.status === 'rejected');
      if (failed) throw failed.reason;
      results.push(...batch.map(item => item.value));
    }
    return results;
  }
  const redact = value => {
    let result = String(value);
    for (const [key, secret] of Object.entries(env)) if (typeof secret === 'string' && secret.length >= 12 && /TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL/.test(key)) result = result.split(secret).join('[credential redacted]');
    return result;
  };
  async function api(path, { method = 'GET', body, signal, allow404 = false } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw fail(400, 'Invalid repository operation.');
    if (method !== 'GET' && !token()) throw fail(503, 'Connect GitHub with repository Contents and Actions write access to run coding tasks.');
    let response;
    try {
      response = await fetcher(base + path, { method, redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'UFIConnect-Office-AI',
          ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw fail(502, 'GitHub did not confirm this operation. Check the task receipt before retrying.'); }
    if (allow404 && response.status === 404) { await response.body?.cancel?.(); return null; }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw fail(response.status === 409 || response.status === 422 ? 409 : response.status === 429 ? 429 : 502,
        response.status === 409 || response.status === 422 ? 'GitHub rejected this change because the reference changed or repository rules do not allow it.' : 'GitHub could not complete the operation. Check the saved connection and its repository permissions.');
    }
    if (response.status === 204) return {};
    const reader = response.body?.getReader();
    if (!reader) throw fail(502, 'GitHub returned an unreadable response.');
    const chunks = []; let bytes = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
        if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw fail(502, 'GitHub response exceeds task capacity.'); } chunks.push(Buffer.from(part.value)); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error.publicMessage) throw error; throw fail(502, 'GitHub returned an unreadable response.'); }
    finally { reader.releaseLock(); }
  }
  const requireSha = sha => { if (!SHA.test(sha || '')) throw fail(400, 'Use a pinned repository commit.'); return sha; };
  async function head(signal) {
    const ref = await api('/git/ref/heads/main', { signal });
    const sha = requireSha(ref?.object?.sha);
    const commit = await api(`/git/commits/${sha}`, { signal });
    return { sha, treeSha: requireSha(commit?.tree?.sha), repository };
  }
  async function tree(ref, signal) {
    sourceCache(signal); requireSha(ref);
    const known = cached(trees, ref);
    if (known) return known.entries;
    const credential = token();
    const result = await api(`/git/trees/${requireSha(ref)}?recursive=1`, { signal });
    if (result.truncated || !Array.isArray(result.tree)) throw fail(413, 'Repository tree exceeds task capacity.');
    const entries = result.tree.filter(item => item.type === 'blob' && ['100644', '100755'].includes(item.mode) && repositoryPath(item.path) && SHA.test(item.sha));
    const bytes = Buffer.byteLength(JSON.stringify(entries));
    sourceCache(signal);
    if (credential !== token()) throw fail(409, 'The repository connection changed. Retry this read with the current connection.');
    if (credential === token() && bytes <= 2 * 1024 * 1024) {
      if (trees.has(ref)) { treeBytes -= trees.get(ref).bytes; trees.delete(ref); }
      while (trees.size >= 6 || treeBytes + bytes > 2 * 1024 * 1024) {
        const first = trees.keys().next().value; treeBytes -= trees.get(first).bytes; trees.delete(first);
      }
      trees.set(ref, { entries, bytes }); treeBytes += bytes;
    }
    return entries;
  }
  async function listFiles({ ref, prefix = '', query = '' }, signal) {
    if (typeof prefix !== 'string' || typeof query !== 'string' || prefix.length > 200 || query.length > 120) throw fail(400, 'Use a short file prefix or search term.');
    const matches = (await tree(ref, signal)).filter(item => item.path.startsWith(prefix) && item.path.toLowerCase().includes(query.toLowerCase()));
    return { ref, total: matches.length, truncated: matches.length > 160, files: matches.slice(0, 160).map(({ path, sha, size }) => ({ path, sha, bytes: size })) };
  }
  async function file(ref, path, signal) {
    if (!repositoryPath(path)) throw fail(400, 'Choose an approved repository text file.');
    const entry = (await tree(ref, signal)).find(item => item.path === path);
    if (!entry) return null;
    if (entry.size > 4 * 1024 * 1024) throw fail(413, 'This file is too large for AI tasks.');
    sourceCache(signal);
    const credential = token(), known = cached(blobs, entry.sha);
    let content = known?.content;
    if (content === undefined) {
      const blob = await api(`/git/blobs/${entry.sha}`, { signal });
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw fail(502, 'GitHub returned unsupported file content.');
      const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
      content = bytes.toString('utf8');
      if (!Buffer.from(content).equals(bytes) || content.includes('\0') || blobSha(content) !== entry.sha) throw fail(502, 'GitHub file content failed integrity validation.');
      sourceCache(signal);
      if (credential !== token()) throw fail(409, 'The repository connection changed. Retry this read with the current connection.');
      if (redact(content) !== content || credentialMaterial(content)) throw fail(400, 'This repository file contains credential material and cannot enter task context.');
      if (credential === token() && bytes.length <= 256 * 1024) {
        if (blobs.has(entry.sha)) { blobBytes -= blobs.get(entry.sha).bytes; blobs.delete(entry.sha); }
        while (blobs.size >= 24 || blobBytes + bytes.length > 4 * 1024 * 1024) {
          const first = blobs.keys().next().value; blobBytes -= blobs.get(first).bytes; blobs.delete(first);
        }
        blobs.set(entry.sha, { content, bytes: bytes.length }); blobBytes += bytes.length;
      }
    }
    if (redact(content) !== content || credentialMaterial(content)) throw fail(400, 'This repository file contains credential material and cannot enter task context.');
    return { path, sha: entry.sha, content, mode: entry.mode };
  }
  async function readFile({ ref, path, startLine, endLine }, signal) {
    const found = await file(ref, path, signal);
    if (!found) throw fail(404, 'This repository file does not exist at the selected commit.');
    return rangeOf(found, startLine, endLine);
  }
  async function search({ ref, paths, query }, signal) {
    if (typeof query !== 'string' || !query || query.length > 240 || !Array.isArray(paths) || !paths.length || paths.length > 8) throw fail(400, 'Search a literal phrase in one to eight selected files.');
    const hits = [];
    if (paths.some(path => !repositoryPath(path))) throw fail(400, 'Choose approved repository text files.');
    // Warm one tree before parallel blob reads; output remains in request order.
    await tree(ref, signal);
    for (const found of await concurrent(paths, path => file(ref, path, signal))) {
      if (!found) continue;
      const lines = found.content.split('\n');
      for (let i = 0; i < lines.length && hits.length < 40; i++) if (lines[i].toLowerCase().includes(query.toLowerCase())) hits.push({ path: found.path, sha: found.sha, line: i + 1, text: lines[i].slice(0, 400) });
    }
    return { hits, truncated: hits.length >= 40 };
  }
  async function edit({ ref, ...input }, staged, signal) {
    if (VERIFICATION_PATHS.has(input.path)) throw fail(400, 'A task cannot change the verification workflow or decision helpers used to approve its own publication.');
    const previous = staged || await file(ref, input.path, signal);
    const next = applyRepositoryEdit(previous, input);
    if (redact(next.content) !== next.content) throw fail(400, 'Configured credentials cannot be committed.');
    return next;
  }
  async function candidate({ taskId, baseSha, files, message, createdAt }, signal) {
    if (!UUID.test(taskId || '') || !Array.isArray(files) || !files.length || files.length > 12 || typeof message !== 'string' || message.length < 6 || message.length > 180) throw fail(400, 'A candidate needs a task ID, commit message, and one to twelve edited files.');
    if (!Number.isFinite(Date.parse(createdAt))) throw fail(400, 'A candidate needs a valid saved creation time.');
    requireSha(baseSha);
    const entries = await tree(baseSha, signal);
    if (files.some(item => VERIFICATION_PATHS.has(item.path))) throw fail(400, 'A task cannot change the verification workflow or decision helpers used to approve its own publication.');
    if (new Set(files.map(item => item.path)).size !== files.length) throw fail(400, 'Each candidate path must occur only once.');
    for (const item of files) {
      const original = entries.find(entry => entry.path === item.path);
      if (!repositoryPath(item.path) || (original?.sha || null) !== item.originalSha || typeof item.content !== 'string' || blobSha(item.content) !== item.sha || redact(item.content) !== item.content) throw fail(409, 'An edited file no longer matches its pinned source.');
    }
    const changes = await concurrent(files, async item => {
      const original = entries.find(entry => entry.path === item.path);
      const blob = await api('/git/blobs', { method: 'POST', body: { content: item.content, encoding: 'utf-8' }, signal });
      if (blob.sha !== item.sha) throw fail(502, 'GitHub did not confirm the expected file revision.');
      return { path: item.path, mode: original?.mode || '100644', type: 'blob', sha: item.sha };
    });
    const parent = await api(`/git/commits/${baseSha}`, { signal });
    const nextTree = await api('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: changes }, signal });
    const timestamp = new Date(createdAt).toISOString();
    const identity = { name: 'UFIConnect Office AI', email: 'office-ai@uficonnect.org', date: timestamp };
    const commit = await api('/git/commits', { method: 'POST', body: { message: `office-ai: ${message}`, tree: requireSha(nextTree.sha), parents: [baseSha], author: identity, committer: identity }, signal });
    const sha = requireSha(commit.sha), ref = `office-ai/${taskId}`;
    // Immutable validation tags leave branch protections and production untouched.
    const existing = await api(`/git/ref/tags/${ref}`, { signal, allow404: true });
    if (existing && existing.object?.sha !== sha) throw fail(409, 'This task already has a different immutable candidate. Start a new task.');
    if (!existing) {
      try { await api('/git/refs', { method: 'POST', body: { ref: `refs/tags/${ref}`, sha }, signal }); }
      catch (error) { const recorded = await api(`/git/ref/tags/${ref}`, { signal, allow404: true }); if (recorded?.object?.sha !== sha) throw error; }
    }
    return { sha, baseSha, ref, refType: 'tag', url: `https://github.com/${repository}/commit/${sha}`, published: false };
  }
  async function checks(candidate, { dispatch = false, signal } = {}) {
    requireSha(candidate.sha);
    if (!/^office-ai\/[a-f0-9-]{36}$/.test(candidate.ref || '')) throw fail(400, 'Use this task’s immutable validation reference.');
    const ref = await api(`/git/ref/tags/${candidate.ref}`, { signal });
    if (ref.object?.sha !== candidate.sha) throw fail(409, 'The validation reference does not match this candidate.');
    const data = Number.isSafeInteger(candidate.verificationRunId) && candidate.verificationRunId > 0
      ? { workflow_runs: [await api(`/actions/runs/${candidate.verificationRunId}`, { signal })] }
      : await api(`/actions/workflows/verify.yml/runs?head_sha=${candidate.sha}&event=workflow_dispatch&per_page=30`, { signal });
    const runs = (data.workflow_runs || []).filter(run => run.head_sha === candidate.sha && run.event === 'workflow_dispatch'
      && run.path?.split('@')[0] === '.github/workflows/verify.yml').sort((a, b) => Number(b.id) - Number(a.id));
    if (!runs.length && dispatch) {
      const receipt = await api('/actions/workflows/verify.yml/dispatches', { method: 'POST', body: { ref: candidate.ref }, signal });
      const id = Number.isSafeInteger(receipt.workflow_run_id) && receipt.workflow_run_id > 0 ? receipt.workflow_run_id : null;
      return [{ ...(id ? { id } : {}), name: 'Verify UFIconnect', status: 'queued', conclusion: null, sha: candidate.sha,
        url: id ? `https://github.com/${repository}/actions/runs/${id}` : `https://github.com/${repository}/actions/workflows/verify.yml` }];
    }
    return runs.slice(0, 1).map(run => ({ id: run.id, name: 'Verify UFIconnect', status: run.status, conclusion: run.conclusion,
      sha: run.head_sha, url: `https://github.com/${repository}/actions/runs/${run.id}` }));
  }
  async function verificationFailure(candidate, { signal } = {}) {
    // Revalidate the immutable reference and exact workflow before reading its
    // diagnostics. Step names are bounded untrusted data, never instructions.
    const [check] = await checks(candidate, { signal });
    if (!check || check.sha !== candidate.sha || check.status !== 'completed' || check.conclusion === 'success'
      || !Number.isSafeInteger(check.id) || check.id <= 0) throw fail(409, 'No failed verification receipt matches this candidate.');
    const data = await api(`/actions/runs/${check.id}/jobs?filter=latest&per_page=100`, { signal });
    const failed = value => ['failure', 'timed_out', 'action_required', 'startup_failure', 'cancelled'].includes(value);
    const label = value => redact(String(value || '')).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
    const jobs = (Array.isArray(data.jobs) ? data.jobs : []).filter(job => failed(job.conclusion)
      && (job.run_id === undefined || job.run_id === check.id)).slice(0, 12).map(job => ({
      name: label(job.name), conclusion: job.conclusion,
      ...(Number.isSafeInteger(job.id) && job.id > 0 ? { url: `https://github.com/${repository}/actions/runs/${check.id}/job/${job.id}` } : {}),
      steps: (Array.isArray(job.steps) ? job.steps : []).filter(step => failed(step.conclusion)).slice(0, 12)
        .map(step => ({ name: label(step.name), conclusion: step.conclusion })),
    }));
    return { sha: check.sha, runId: check.id, conclusion: check.conclusion, url: check.url, failedJobs: jobs,
      truncated: Number(data.total_count) > 100 };
  }
  async function publish(candidate, signal) {
    const evidence = await checks(candidate, { signal });
    if (!evidence.length || evidence[0].status !== 'completed' || evidence[0].conclusion !== 'success') throw fail(409, 'Publication requires successful verification of this exact candidate commit.');
    const current = await head(signal);
    if (current.sha === candidate.sha) return { ...candidate, published: true };
    if (current.sha !== candidate.baseSha) throw Object.assign(fail(409, 'Main changed while this task was being checked. Rebase unchanged source files and verify the new candidate before publication.'), { code: 'MAIN_MOVED' });
    const commit = await api(`/git/commits/${requireSha(candidate.sha)}`, { signal });
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== current.sha) throw fail(409, 'This candidate is not a direct continuation of current main.');
    try { await api('/git/refs/heads/main', { method: 'PATCH', body: { sha: candidate.sha, force: false }, signal }); }
    catch (error) { if ((await head(signal)).sha !== candidate.sha) throw error; }
    return { ...candidate, published: true };
  }
  async function rebase(previous, files, signal) {
    requireSha(previous.sha); requireSha(previous.baseSha);
    if (previous.published || !/^office-ai\/[a-f0-9-]{36}$/.test(previous.ref || '')) throw fail(409, 'Only an unpublished task candidate can be rebased.');
    const current = await head(signal);
    if (current.sha === previous.sha) return { ...previous, published: true };
    if (current.sha === previous.baseSha) return previous;
    // A lost publication response followed by another release (or a revert)
    // must not reapply an operation that already entered main's history.
    const ancestry = await api(`/compare/${previous.sha}...${current.sha}`, { signal });
    requireSha(ancestry.merge_base_commit?.sha);
    if (ancestry.merge_base_commit.sha === previous.sha) throw fail(409, 'This candidate is already in main history. Reconcile its deployment receipts instead of publishing it again.');
    const entries = await tree(current.sha, signal);
    if (!Array.isArray(files) || !files.length || files.some(item => !object(item) || (entries.find(entry => entry.path === item.path)?.sha || null) !== item.originalSha))
      throw fail(409, 'Main changed a file edited by this task. Its saved changes need conflict review before publication.');
    const original = await api(`/git/commits/${previous.sha}`, { signal });
    if (original.parents?.length !== 1 || original.parents[0].sha !== previous.baseSha) throw fail(409, 'The saved candidate does not match its original base.');
    const digest = createHash('sha256').update(`${previous.ref}\0${current.sha}`).digest('hex').slice(0, 32);
    const taskId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20)}`;
    const result = await candidate({ taskId, baseSha: current.sha, files,
      message: String(original.message || '').replace(/^office-ai: /, '').slice(0, 180), createdAt: original.author?.date }, signal);
    return { ...result, rebasedFrom: previous.sha };
  }
  async function verifiedHead(signal) {
    const current = await head(signal);
    const data = await api(`/actions/workflows/verify.yml/runs?head_sha=${current.sha}&status=completed&per_page=30`, { signal });
    const successful = (data.workflow_runs || []).find(run => run.head_sha === current.sha && run.status === 'completed' && run.conclusion === 'success'
      && ['push', 'workflow_dispatch'].includes(run.event) && run.path?.split('@')[0] === '.github/workflows/verify.yml');
    if (!successful) throw fail(409, 'The current main commit has not passed Verify. Complete its checks before deployment.');
    return { ...current, check: { id: successful.id, sha: current.sha, conclusion: 'success', url: `https://github.com/${repository}/actions/runs/${successful.id}` } };
  }
  return { repository, configured: () => !!token(), head, listFiles, readFile, search, edit, candidate, checks, verificationFailure, publish, rebase, verifiedHead, redact, deployments: createDeploymentObserver({ env, fetcher, github: api }) };
}

module.exports = { createOfficeAIRepository, repositoryPath, applyRepositoryEdit, rangeOf, blobSha };
