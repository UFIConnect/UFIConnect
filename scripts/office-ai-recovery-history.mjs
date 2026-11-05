import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function captureRecoveryHistory(env, outputDirectory, { fetcher = fetch, signal } = {}) {
  const repository =
    (env.AUTOFIX_GITHUB_OWNER || 'UFIConnect') + '/' + (env.AUTOFIX_GITHUB_REPO || 'UFIConnect');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error('Invalid repository identity');
  if (!env.RENDER_API_KEY) throw Error('Load the protected Render read credential.');
  const token = env.OFFICE_GITHUB_TOKEN || env.AUTOFIX_GITHUB_TOKEN || '';
  const roles = {
    api: env.RENDER_SERVICE_API_ID,
    pipeline: env.RENDER_SERVICE_PIPELINE_ID,
    office: env.RENDER_SERVICE_OFFICE_ID,
    web: env.RENDER_SERVICE_WEB_ID,
  };
  if (Object.values(roles).some((id) => !/^srv-[a-z0-9]+$/.test(id || '')))
    throw Error('Configure all four Render service identifiers.');
  async function read(origin, route, key) {
    const response = await fetcher(origin + route, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('Recovery evidence read failed HTTP' + response.status);
    return response.json();
  }
  const render = (route) => read('https://api.render.com/v1', route, env.RENDER_API_KEY),
    github = (route) => read('https://api.github.com/repos/' + repository, route, token);
  async function deploymentHistory(id) {
    const deploys = [], seen = new Set();
    let cursor;
    for (;;) {
      signal?.throwIfAborted();
      const page = await render('/services/' + id + '/deploys?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(page)) throw Error('Invalid deployment history response');
      deploys.push(...page.map((item) => item.deploy || item));
      if (page.length < 100) return { deploys, complete: true };
      const next = page.at(-1)?.cursor;
      if (typeof next !== 'string' || !next) return { deploys, complete: false };
      if (seen.has(next)) throw Error('Deployment history returned a repeated pagination cursor');
      seen.add(next); cursor = next;
    }
  }
  const services = await Promise.all(
    Object.entries(roles).map(async ([role, id]) => {
      const history = await deploymentHistory(id);
      return { role, id, historyComplete: history.complete,
      deploys: history.deploys
        .filter(
          (d) => ['live', 'deactivated'].includes(d.status) && /^[a-f0-9]{40}$/.test(d.commit?.id || ''),
        ),
    };}),
  );
  const candidates = [...new Set(services[0].deploys.map((d) => d.commit.id))]
    .filter((sha) => services.every((s) => s.deploys.some((d) => d.commit.id === sha)))
    .sort(
      (a, b) =>
        Date.parse(services[0].deploys.find((d) => d.commit.id === b).createdAt) -
        Date.parse(services[0].deploys.find((d) => d.commit.id === a).createdAt),
    );
  const points = [];
  let examined = 0;
  for (const sha of candidates) {
    examined++;
    const [commit, runs] = await Promise.all([
      github('/git/commits/' + sha),
      github('/actions/workflows/verify.yml/runs?head_sha=' + sha + '&status=completed&per_page=30'),
    ]);
    const verified = runs.workflow_runs?.find(
      (r) =>
        r.head_sha === sha &&
        r.status === 'completed' &&
        r.conclusion === 'success' &&
        ['push', 'workflow_dispatch'].includes(r.event) &&
        r.path?.split('@')[0] === '.github/workflows/verify.yml',
    );
    if (!verified) continue;
    if (commit.sha !== sha || !/^[a-f0-9]{40}$/.test(commit.tree?.sha || ''))
      throw Error('Immutable source validation failed');
    points.push({
      number: points.length + 1,
      kind: 'source-rebuild-recovery-point',
      sha,
      treeSha: commit.tree.sha,
      sourceAvailable: true,
      sourceUrl: 'https://github.com/' + repository + '/commit/' + sha,
      verifiedAt: verified.updated_at,
      verification: { id: verified.id, conclusion: verified.conclusion, url: verified.html_url },
      deployments: services.map((s) => {
        const d = s.deploys.find((d) => d.commit.id === sha);
        return {
          role: s.role,
          serviceId: s.id,
          deployId: d.id,
          observedStatus: d.status,
          finishedAt: d.finishedAt,
          sourceSha: d.commit.id,
        };
      }),
      fastRollbackArtifactAvailability: 'unverified-provider-plan-retention',
      rebuildDeployBody: { commitId: sha, clearCache: 'do_not_clear' },
      productionRestoreAttempted: false,
    });
  }
  if (!points.length)
    throw Error('No complete verified historical recovery points were found');
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    scope:
      'Exact immutable source and successful verification/deployment receipts across API,pipeline,Office,web. Rebuild recovery, not proof of retained fast-rollback artifacts or database restoration.',
    points,
    examined,
    retentionCapacity: 'unlimited',
    deploymentHistoryCoverage: services.map((service) => ({role:service.role,returnedDeployments:service.deploys.length,providerPaginationComplete:service.historyComplete})),
    providerArtifactRetentionVerified: false,
    liveRollbackExecuted: false,
  };
  const encoded = JSON.stringify(manifest, null, 2);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, 'production-recovery-points.json'), encoded);
  await fs.writeFile(
    path.join(outputDirectory, 'production-recovery-points.sha256'),
    createHash('sha256').update(encoded).digest('hex') + '\n',
  );
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  captureRecoveryHistory(
    process.env,
    path.resolve(process.env.OFFICE_RECOVERY_DIRECTORY || '.cache/office-recovery'),
  )
    .then((m) =>
      console.log(
        JSON.stringify({
          verifiedRecoveryPoints: m.points.length,
          successfulDeployReceipts: m.points.reduce((n, p) => n + p.deployments.length, 0),
          fastRollbackArtifactAvailabilityVerified: false,
          liveRollbackExecuted: false,
        }),
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
