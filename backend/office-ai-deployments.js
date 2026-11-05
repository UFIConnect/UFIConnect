'use strict';

const FAILED = new Set(['build_failed', 'pre_deploy_failed', 'update_failed', 'canceled', 'deactivated']);
const SERVICES = ['api', 'pipeline', 'web', 'office'];

// Observation only: publishing already triggers the release workflow. Polling
// must never dispatch another build or deploy an unrelated/newer commit.
function createDeploymentObserver({ env, fetcher, github }) {
  return async function observeDeployment(commit, files, signal) {
    const deployments = await Promise.all(SERVICES.map(async service => {
      const serviceId = env[`RENDER_SERVICE_${service.toUpperCase()}_ID`];
      if (!env.RENDER_API_KEY || !/^srv-[a-z0-9]+$/.test(serviceId || '')) {
        return { service, status: 'unavailable', sha: commit.sha };
      }
      const response = await fetcher(`https://api.render.com/v1/services/${serviceId}/deploys?limit=20`, {
        method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${env.RENDER_API_KEY}` },
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw Error('The deployment provider could not be checked.');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw Error('The deployment provider returned an unreadable receipt.');
      const exact = rows.map(row => row.deploy || row).find(row => row.commit?.id === commit.sha);
      return { service, status: exact?.status || 'queued', sha: commit.sha,
        ...(exact?.id ? { id: exact.id, url: `https://dashboard.render.com/${serviceId}/deploys/${exact.id}` } : {}) };
    }));
    if (files.some(file => /^(?:office\/|infra\/office-ai-site\/)/.test(file.path))) {
      const data = await github(`/commits/${commit.sha}/check-runs?per_page=100`, { signal });
      const exact = (data.check_runs || []).find(check => check.head_sha === commit.sha
        && String(check.details_url || '').startsWith('https://dash.cloudflare.com/')
        && String(check.output?.summary || '').includes('uficonnect-office-ai-site'));
      deployments.push({ service: 'uficonnect.ai', sha: commit.sha,
        status: exact?.status === 'completed' ? (exact.conclusion === 'success' ? 'live' : 'build_failed') : 'queued',
        ...(exact ? { id: exact.id, url: exact.details_url } : {}) });
    }
    return { deployments, ready: deployments.every(item => item.status === 'live'),
      failed: deployments.some(item => FAILED.has(item.status)),
      unavailable: deployments.some(item => item.status === 'unavailable') };
  };
}

module.exports = { createDeploymentObserver };
