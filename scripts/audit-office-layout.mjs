import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import catalog from '../shared/analytics-categories.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/office-layout');
const API = 'https://office-layout.invalid';
const { BASE_OFFICE_CONTROLS } = createRequire(import.meta.url)('../backend/office-controls.js');
const now = '2026-11-04T18:00:00Z';
const sections = [
  ['pipeline', 'Pipeline'], ['post-pipeline', 'Post Pipeline'], ['feed-audit', 'Feed Audit'],
  ['topic-transfer', 'Topic Transfer'], ['topics', 'Topics'], ['feed', 'Feed Manager'],
  ['users', 'Users'], ['analytics', 'Analytics'], ['reports', 'Reports'],
  ['agents', 'Agents'], ['autofix', 'Autofix'], ['versions', 'Versions'],
  ['controls', 'Controls'], ['setup', 'Setup'],
];
const generic = {
  server: { uptime: 120000, db: 'connected' }, agents: {}, sources: { total: 0, workers: [] },
  items: [], reasons: [], commands: [], history: [], controls: BASE_OFFICE_CONTROLS,
  versions: [], policy: {}, attempts: [], enabled: true,
};
const analytics = { available: true, mode: 'aggregate', range: { from: '2026-11-01', to: '2026-11-04' },
  daily: [{ day: '2026-11-04', views: 3 }],
  categories: Object.values(catalog).map(meta => ({ ...meta, daily: [{ day: '2026-11-04', views: 3, errors: 0 }] })),
  performance: { byCode: [], details: [] }, storage: { connected: true, status: 'ready', collector: {} },
  geography: { available: true, daily: [], cityHeadersEnabled: true }, service: { responses: [] },
};
const dataFor = pathname => {
  if (pathname === '/office/analytics/pageviews') return analytics;
  if (pathname === '/office/analytics/geography') return { available: true, countries: [], cities: [], total: 0 };
  if (pathname === '/office/ai') return { configured: true, researchAvailable: true, model: '@cf/test/layout', provider: 'Cloudflare' };
  if (pathname === '/office/ai/conversations') return { conversations: [], storage: 'encrypted-database' };
  if (pathname === '/office/ai/tasks') return { tasks: [], capabilities: { editCode: true, publish: true, deploy: true, operate: true, deployTargets: [{ id: 'office', label: 'Office website' }] } };
  if (pathname === '/office/ai/terminal') return { sessions: [], capabilities: { available: true, configured: true, repository: 'fixture/office' } };
  if (pathname === '/office/ai/functions') return { functions: [], runtime: 'Cloudflare' };
  if (pathname === '/office/ai/memory') return { entries: [], storage: { count: 0 } };
  if (pathname === '/office/ai/activity') return { events: [], findings: [], history: [], summary: {} };
  if (pathname === '/office/ai/tools') return { tools: [
    { id: 'review', kind: 'prompt', name: 'Product review', description: 'Review value, feasibility, and next steps.', instructions: 'Consider the user and explain tradeoffs.' },
    { id: 'research', kind: 'prompt', name: 'Research briefing', description: 'Find evidence and compare alternative approaches.', instructions: 'Cite your sources and state uncertainties.' },
  ] };
  if (pathname === '/office/connections') return { connections: ['github', 'render', 'cloudflare', 'notion', 'slack', 'linear'].map(id => ({ id, configured: false })) };
  if (pathname === '/office/feed-audit') return { items: [], sources: [], reasons: [], commands: [], summary: { checked: 100, approved: 95, rejected: 5, approvalPct: 95 }, policy: {} };
  if (pathname === '/office/post-pipeline') return { posts: [], items: [], sources: [], stages: [], stats: {}, coverage: { retentionDays: 30, maxEvents: 10000 }, tracker: {}, fetchedAt: now, pagination: { total: 0, pages: 1 } };
  if (pathname === '/office/topic-transfer') return { topics: [], taxonomy: [{ topic: 'Engineering', subtopics: ['Software'] }], unknown: { live: 0, staged: 0 }, generatedAt: now };
  if (pathname === '/office/topics') return { available: true, topics: [{ topic: 'Engineering', total: 12, sources: [{ source: 'github', count: 12 }] }] };
  if (pathname === '/office/users') return { available: true, total: 1, recent: [{ id: 'layout-member', name: 'Review Member', email: 'review@example.com', onboarded: true, createdAt: now }], pagination: { pages: 1, total: 1 }, generatedAt: now, email: { available: false } };
  if (pathname === '/office/reports') return { reports: [] };
  if (pathname === '/office/versions') return { backend: { name: 'Office API', version: '1.0.0', node: '24' }, services: [] };
  if (pathname === '/office/setup') return { services: [], summary: {} };
  return generic;
};
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  define: { 'import.meta.env.MODE': JSON.stringify('release-local'), 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API) },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
const findings = [];
try {
  await server.listen();
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${API}/**`, async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type,accept', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      if (request.headers()['x-office-token'] !== 'layout-fixture') return route.fulfill({ status: 401, headers, json: {} });
      if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
      return route.fulfill({ headers, json: dataFor(url.pathname) });
    });
    await page.goto(server.resolvedUrls.local[0] + '#office-ai');
    await page.getByLabel('Access token', { exact: true }).fill('layout-fixture');
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Office sections' });
    await nav.locator('[data-office-view="office-ai"]').click();
    await page.getByRole('button', { name: 'Open Pip workspace', exact: true }).click();
    await page.getByText('Cloudflare configured', { exact: true }).waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Settings & history', exact: true }).click();
    const toggle = nav.locator('.office-nav-toggle');
    const inspect = async name => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => {
        const scrollWidth = document.documentElement.scrollWidth;
        if (scrollWidth <= innerWidth + 1) return null;
        const elements = [...document.querySelectorAll('main *')].filter(el => {
          const rect = el.getBoundingClientRect();
          if (!rect.width || rect.right <= innerWidth + 1) return false;
          for (let p = el.parentElement; p; p = p.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return false;
          return true;
        }).slice(0, 8).map(el => ({ tag: el.tagName, className: el.className, text: el.textContent.slice(0, 60) }));
        return { scrollWidth, viewport: innerWidth, elements };
      });
      if (overflow) findings.push({ width, name, overflow });
      assert.equal(await page.getByRole('heading', { name: 'This section couldn’t open', exact: true }).count(), 0, `${name} renders at ${width}`);
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
    };
    for (const [tab, label] of [['conversation', 'Conversation'], ['tasks', 'Tasks'], ['upgrades', 'Upgrade Pip'], ['memory', 'Memory'], ['activity', 'Activity'], ['terminal', 'Terminal'], ['functions', 'Functions'], ['tools', 'My tools'], ['connections', 'Connections'], ['commands', 'Office controls']]) {
      await page.locator('.office-ai-tabs').getByRole('button', { name: new RegExp(label) }).click();
      await page.locator('.office-ai-tabs button[aria-pressed=true]').waitFor();
      if (tab === 'conversation') {
        const composer = page.locator('.office-ai-composer textarea:visible');
        await composer.fill(`Preserved ${tab} draft`);
      }
      await inspect(`chat-${tab}`);
    }
    for (const [tab, label] of [['conversation', 'Conversation']]) {
      await page.locator('.office-ai-tabs').getByRole('button', { name: label, exact: true }).click();
      assert.equal(await page.locator('.office-ai-composer textarea:visible').inputValue(), `Preserved ${tab} draft`);
      const activeBounds = await page.locator('.office-ai-tabs button[aria-pressed=true]').boundingBox();
      assert.ok(activeBounds.x >= 0 && activeBounds.x + activeBounds.width <= width, 'Selected chatbot tab stays visible');
    }
    await page.getByRole('button', { name: 'Minimize Pip', exact: true }).click();
    await toggle.press('ArrowDown');
    const search = nav.getByRole('searchbox', { name: 'Find an Office tool' });
    await search.waitFor();
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await inspect('more-tools');
    await search.press('Escape');
    for (const [id, label] of sections) {
      let button = nav.getByRole('button', { name: label, exact: true });
      if (!(await button.isVisible())) await toggle.click();
      await button.click();
      await page.waitForFunction(id => document.querySelector('main')?.dataset.officeSection === id, id);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Tool menu closes after selection');
      await inspect(id);
    }
    assert.deepEqual(writes, [], 'Browsing layouts never runs commands');
    assert.deepEqual(errors, [], `No browser errors at ${width}`);
    await page.close();
    console.log(`Checked chatbot tabs and ${sections.length} tool screens at ${width}px`);
  }
  await fs.writeFile(path.join(output, 'findings.json'), JSON.stringify(findings, null, 2));
  assert.deepEqual(findings, [], 'All screens fit their viewport');
  console.log(`PASS: responsive Office layouts; screenshots saved to ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
