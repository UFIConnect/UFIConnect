const BASE_OFFICE_CONTROLS = Object.freeze([
  {
    id: 'feed.refresh-all',
    category: 'Public feed',
    label: 'Refresh every feed source',
    description: 'Queue a fresh, rate-limited pull from every active public source.',
    target: 'pipeline',
    impact: 'high',
    requiresConfirmation: true,
  },
  {
    id: 'feed.transfer-staging',
    category: 'Public feed',
    label: 'Transfer staged posts',
    description: 'Screen and promote every currently staged post into the public feed cache.',
    target: 'api',
    impact: 'medium',
    requiresConfirmation: true,
  },
  {
    id: 'feed.equalize',
    category: 'Public feed',
    label: 'Drain the equalizer',
    description: 'Fairly interleave the current source queues and publish their accepted posts.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'feed.sync-cache',
    category: 'Public feed',
    label: 'Sync source caches',
    description: 'Merge fresh per-source cache entries into the shared public feed cache.',
    target: 'pipeline',
    impact: 'medium',
  },
  {
    id: 'feed.sort-newest',
    category: 'Public feed',
    label: 'Re-sort the public feed',
    description: 'Reapply newest-first ordering, deduplication, and diversity ranking.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'feed.rebalance-sources',
    category: 'Public feed',
    label: 'Rebalance source distribution',
    description: 'Rebuild the diversified feed head and refill genuinely stale empty sources.',
    target: 'pipeline',
    impact: 'medium',
  },
  {
    id: 'feed.optimize-sources',
    category: 'Public feed',
    label: 'Heal source workers',
    description: 'Audit every source worker and queue recovery for paused, stale, or degraded sources.',
    target: 'pipeline',
    impact: 'medium',
  },
  {
    id: 'feed.audit-topics',
    category: 'Public feed',
    label: 'Audit post topics',
    description: 'Compare assigned topics with post content and queue confident corrections.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'feed.apply-topic-fixes',
    category: 'Public feed',
    label: 'Apply topic corrections',
    description: 'Apply queued topic corrections to live cache entries and their database rows.',
    target: 'pipeline',
    impact: 'high',
    requiresConfirmation: true,
  },
  {
    id: 'feed.audit-mix',
    category: 'Public feed',
    label: 'Audit feed mix',
    description: 'Check source concentration, job cadence, freshness, and thin personalized pools.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'feed.audit-sorting',
    category: 'Public feed',
    label: 'Audit feed sorting',
    description: 'Inspect score spread and newest-content overlap in ranked feed pools.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'location.refresh',
    category: 'Travel and restaurants',
    label: 'Refresh location feeds',
    description: 'Expire Travel and Restaurants discovery caches so the next request retrieves current results.',
    target: 'api',
    impact: 'medium',
    requiresConfirmation: true,
  },
  {
    id: 'location.verify-live-travel',
    category: 'Travel and restaurants',
    label: 'Verify live travel cameras',
    description: 'Recheck the live and embeddable state of the Travel camera catalog.',
    target: 'api',
    impact: 'medium',
  },
  {
    id: 'jobs.refresh',
    category: 'Jobs',
    label: 'Refresh career sources',
    description: 'Queue fresh listings from Indeed, Remote OK, USAJobs, Remotive, and The Muse.',
    target: 'pipeline',
    impact: 'medium',
    requiresConfirmation: true,
  },
  {
    id: 'health.website',
    category: 'Public health',
    label: 'Run complete website health',
    description: 'Audit the public web, performance, SEO, cache, API, pipeline, Office, and PWA surfaces.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.performance',
    category: 'Public health',
    label: 'Check public performance',
    description: 'Measure the public page response, transfer size, and performance budget.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.seo',
    category: 'Public health',
    label: 'Check public SEO',
    description: 'Validate public metadata, canonical tags, crawl files, and structured data.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.cache',
    category: 'Public health',
    label: 'Check public cache policy',
    description: 'Audit public cache headers and service-worker delivery behavior.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.api',
    category: 'Public health',
    label: 'Check public API',
    description: 'Run the public API health and readiness checks.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.pipeline',
    category: 'Public health',
    label: 'Check pipeline service',
    description: 'Run the deployed pipeline health and readiness checks.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.office',
    category: 'Public health',
    label: 'Check Office deployment',
    description: 'Check the deployed Office shell and its static health endpoint.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.pwa',
    category: 'Public health',
    label: 'Check PWA assets',
    description: 'Validate the public manifest, service worker, icons, and installable app assets.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'health.storage',
    category: 'Public health',
    label: 'Check feed storage',
    description: 'Audit pipeline persistence and confirm recent feed rows can be read from storage.',
    target: 'pipeline',
    impact: 'low',
  },
  {
    id: 'runtime.stability',
    category: 'Runtime',
    label: 'Run stability guards',
    description: 'Recalculate memory, event-loop, and adaptive refresh health on both backend services.',
    target: 'both',
    impact: 'low',
  },
  {
    id: 'runtime.trim-caches',
    category: 'Runtime',
    label: 'Trim runtime caches',
    description: 'Reduce in-memory caches on both services without deleting durable feed history.',
    target: 'both',
    impact: 'high',
    requiresConfirmation: true,
  },
  {
    id: 'storage.run-retention',
    category: 'Runtime',
    label: 'Run feed retention',
    description: 'Archive over-cap or stale live rows and prune archive rows under configured policy.',
    target: 'api',
    impact: 'critical',
    requiresConfirmation: true,
  },
  {
    id: 'automation.audit',
    category: 'Automation',
    label: 'Run Autofix audit',
    description: 'Scan eligible server errors and update the Autofix action queue.',
    target: 'api',
    impact: 'low',
  },
  {
    id: 'automation.enable',
    category: 'Automation',
    label: 'Enable Autofix deployment',
    description: 'Allow verified Autofix candidates to use the configured patch and deployment workflow.',
    target: 'api',
    impact: 'critical',
    requiresConfirmation: true,
  },
  {
    id: 'automation.disable',
    category: 'Automation',
    label: 'Disable Autofix deployment',
    description: 'Keep detection active while stopping automated patch deployment.',
    target: 'api',
    impact: 'medium',
    requiresConfirmation: true,
  },
  {
    id: 'commit.web-frontend',
    category: 'Frontend changes',
    label: 'Commit a web frontend file',
    description: 'Review and commit one approved text file under the web frontend to the main branch.',
    target: 'api',
    impact: 'critical',
    requiresConfirmation: true,
    input: 'frontend-file',
    frontendTarget: 'web',
  },
  {
    id: 'commit.mobile-frontend',
    category: 'Frontend changes',
    label: 'Commit an app frontend file',
    description: 'Review and commit one approved text file under the Expo mobile frontend to the main branch.',
    target: 'api',
    impact: 'critical',
    requiresConfirmation: true,
    input: 'frontend-file',
    frontendTarget: 'mobile',
  },
  ...['web', 'api', 'pipeline', 'office', 'mobile'].map((service) => ({
    id: `deploy.${service}`,
    category: 'Deployments',
    label: service === 'mobile' ? 'Build mobile app' : `Deploy ${service === 'web' ? 'public web' : service}`,
    description: service === 'mobile'
      ? 'Start the production Expo EAS workflow for both iOS and Android from the main branch.'
      : `Start a production deployment for the ${service} service using its configured Render hook or API service ID.`,
    target: 'api',
    impact: 'critical',
    requiresConfirmation: true,
  })),
]);

function cleanSource(value) {
  const id = String(value?.id || value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(id)) return null;
  const rawLabel = String(value?.label || id).trim();
  const label = rawLabel.slice(0, 80) || id;
  return { id, label };
}

function buildOfficeControlCatalog(sources = []) {
  const seen = new Set();
  const sourceControls = [];
  for (const value of sources) {
    const source = cleanSource(value);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    sourceControls.push({
      id: `source.refresh.${source.id}`,
      category: 'Individual sources',
      label: `Refresh ${source.label}`,
      description: `Queue a fresh, rate-limited pull from ${source.label} only.`,
      target: 'pipeline',
      impact: 'medium',
      sourceId: source.id,
    });
  }
  return [...BASE_OFFICE_CONTROLS, ...sourceControls];
}

function findOfficeControl(controlId, sources = []) {
  const id = String(controlId || '').trim().toLowerCase();
  return buildOfficeControlCatalog(sources).find((control) => control.id === id) || null;
}

function validateOfficeControlExecution(control, payload) {
  if (!control) return { valid: false, error: 'Unknown Office control.' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Control execution payload must be an object.' };
  }
  if (control.requiresConfirmation && payload.confirmed !== true) {
    return { valid: false, error: 'This control requires explicit confirmation.' };
  }
  return {
    valid: true,
    contextId: String(payload.contextId || 'office-controls').trim().slice(0, 160) || 'office-controls',
    contextLabel: String(payload.contextLabel || 'Manual Office control').trim().slice(0, 180) || 'Manual Office control',
  };
}

function normalizeOfficeFrontendPath(target, value) {
  const candidate = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!candidate || candidate.includes('\0') || candidate.split('/').includes('..')) return null;
  const allowed = target === 'web'
    ? /^(?:web\/(?:src|public)\/[^/].*|web\/index\.html)$/
    : target === 'mobile'
      ? /^mobile\/(?:App\.js|theme\.js|platforms\.js|(?:components|context|screens)\/[^/].*)$/
      : null;
  if (!allowed?.test(candidate) || !OFFICE_FRONTEND_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return null;
  return candidate;
}

module.exports = {
  BASE_OFFICE_CONTROLS,
  buildOfficeControlCatalog,
  findOfficeControl,
  normalizeOfficeFrontendPath,
  validateOfficeControlExecution,
};
const path = require('path');

const OFFICE_FRONTEND_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.jsx', '.json', '.md', '.svg', '.ts', '.tsx', '.txt', '.webmanifest', '.xml',
]);
