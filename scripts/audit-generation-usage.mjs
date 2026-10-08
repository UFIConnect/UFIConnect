import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
const app = await createAppHarness();
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5226, strictPort: false,
    proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});

function usageFor(counts) {
  const now = new Date();
  return {
    period: {
      startsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    },
    limits: Object.fromEntries(Object.entries({ video: 20, image: 50, resume: 30 }).map(([kind, limit]) => {
      const used = counts[kind] || 0;
      return [kind, { limit, used, remaining: limit - used }];
    })),
  };
}

let browser;
let checks = 0;
try {
  await server.listen();
  await fs.mkdir(output, { recursive: true });
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    console.log(`Checking generation usage at ${width}px`);
    const userId = `generation-usage-${width}`;
    app.seedUser(member(userId, { plan: 'pro', resumeBuilderAddon: true }));
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width < 600 });
    let counts = { image: 50, video: 0, resume: 29 };
    let failUsage = false;
    let generationMode = 'success';
    let videoRefreshes = 0;
    const generated = [], savedDrafts = [], exports = [], errors = [], forbidden = [];
    const draft = {
      contact: { name: 'Audit Member', title: 'Designer', email: 'audit@example.invalid', links: [] },
      summary: 'Designer with experience creating useful community products.',
      experience: [{ company: 'Example Studio', role: 'Designer', bullets: ['Improved signup completion.'] }],
      education: [], skills: ['Design', 'Research'],
      coverLetter: { role: 'Designer', company: 'Example', jobDescription: 'Design clear products.', tone: 'Warm and professional', format: 'modern', body: 'An existing editable cover letter.' },
      outreach: { recipientName: 'Alex', recipientRole: 'Design Director', company: 'Example', context: 'I would value a conversation about your design team.', tone: 'Warm and professional', format: 'modern', body: 'An existing editable message.' },
    };
    const history = [
      { id: 'saved-image', kind: 'image', prompt: 'Saved studio artwork', status: 'completed', createdAt: new Date().toISOString(), input: {}, output: { mediaUrl: base + 'icon-512.png', mediaType: 'image' } },
      { id: 'pending-video', kind: 'video', prompt: 'Previously requested video', status: 'processing', resumable: true, createdAt: new Date().toISOString(), input: { durationSeconds: 12 }, output: {} },
    ];
    await context.route('**/api/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/analytics/pageview') return route.fulfill({ status: 204 });
      if (endpoint === '/generation/usage') return route.fulfill({ status: failUsage ? 503 : 200,
        json: failUsage ? { message: 'Generation limits are temporarily unavailable.', code: 'GENERATION_USAGE_UNAVAILABLE' } : usageFor(counts) });
      if (endpoint === '/command-center/media-options') return route.fulfill({ json: { video: { minSeconds: 4, maxSeconds: 300, shortClipSeconds: [4, 8, 12], longFormConfigured: true } } });
      if (endpoint === '/command-center/history') return route.fulfill({ json: { items: history, nextCursor: null } });
      if (endpoint === '/command-center/history/pending-video/refresh') {
        videoRefreshes += 1;
        const item = { ...history[1], status: 'completed', output: { mediaUrl: base + 'media/preparation/professional-introduction.mp4', mediaType: 'video' } };
        return route.fulfill({ json: { item } });
      }
      if (endpoint === '/command-center/media-generate' || endpoint === '/resume-builder/ai-assist' || endpoint === '/resume-builder/application-draft') {
        const body = request.postDataJSON();
        const kind = endpoint === '/command-center/media-generate' ? body.type : 'resume';
        generated.push({ endpoint, body });
        if (generationMode === 'limit') {
          counts[kind] = { image: 50, video: 20, resume: 30 }[kind];
          return route.fulfill({ status: 429, json: { message: 'Monthly generation limit reached.', code: 'MONTHLY_GENERATION_LIMIT', kind, usage: usageFor(counts) } });
        }
        if (generationMode === 'outage') return route.fulfill({ status: 503, json: { message: 'Synthetic provider outage.' } });
        counts[kind] += 1;
        const usage = usageFor(counts);
        if (kind !== 'resume') return route.fulfill({ json: { mediaType: kind, mediaUrl: base + 'icon-512.png', usage } });
        return route.fulfill({ json: endpoint.endsWith('/ai-assist') ? { suggestion: 'A useful generated improvement.', usage } : { draft: 'A useful generated application message.', usage } });
      }
      if (endpoint === '/resume-builder/draft') {
        if (request.method() === 'PUT') { savedDrafts.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: { template: 'modern', data: draft } });
      }
      if (endpoint === '/resume-builder/export') {
        exports.push(endpoint);
        return route.fulfill({ json: { atsScore: 96, filename: 'audit-resume.pdf' } });
      }
      if (endpoint === '/profile/attachments') return route.fulfill({ json: { attachments: [] } });
      if (endpoint === '/jobs/tracking') return route.fulfill({ json: { jobs: [] } });
      if (endpoint === '/opportunities') return route.fulfill({ json: { opportunities: [] } });
      if (endpoint === '/billing/config') return route.fulfill({ json: { paymentsReady: false, tiers: {}, pricing: {} } });
      if (request.method() !== 'GET' && !endpoint.startsWith('/auth/')) {
        forbidden.push(endpoint);
        return route.fulfill({ status: 400, json: { message: 'Unexpected mutation blocked by synthetic audit.' } });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, userId);
    const refreshUsage = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await auditNavigate(page, base + 'command-center?tab=media');
    await page.getByText(/0 of 50 images remaining this month/).waitFor();
    await page.getByPlaceholder('Describe the photo or graphic you want to create').fill('A useful community illustration.');
    const imageButton = page.getByRole('button', { name: 'Generate image', exact: true });
    assert.ok(await imageButton.isDisabled());
    assert.match(await page.getByRole('status').filter({ hasText: 'Monthly image limit reached.' }).textContent(), /Resets .*UTC/);
    await page.locator('.generated-history-row', { hasText: 'Saved studio artwork' }).click();
    assert.ok(await page.getByRole('button', { name: 'Download saved content', exact: true }).isEnabled());
    await page.getByRole('button', { name: 'Reuse prompt', exact: true }).click();
    assert.equal(await page.locator('textarea').inputValue(), 'Saved studio artwork');
    assert.ok(await imageButton.isDisabled());
    await page.locator('.generated-history-row', { hasText: 'Previously requested video' }).click();
    await page.getByRole('button', { name: 'Check video status', exact: true }).click();
    await page.getByRole('button', { name: 'Download saved content', exact: true }).waitFor();
    assert.equal(videoRefreshes, 1, 'A monthly cap must allow a saved video status refresh');
    await page.screenshot({ path: path.join(output, `generation-media-limit-${width}.png`), fullPage: true });
    checks += 6;

    await page.getByRole('button', { name: /^video$/i }).click();
    await page.getByText(/20 of 20 videos remaining this month/).waitFor();
    const videoButton = page.getByRole('button', { name: 'Generate video', exact: true });
    await videoButton.waitFor({ state: 'visible' });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Generate video')?.disabled);
    generationMode = 'limit';
    await videoButton.click();
    await page.getByText(/0 of 20 videos remaining this month/).waitFor();
    assert.ok(await videoButton.isDisabled());
    assert.equal(generated.length, 1);
    await page.getByRole('button', { name: /^image$/i }).click();
    assert.ok(await imageButton.isDisabled(), 'Video usage must preserve the separate exhausted image allowance');
    counts.image = 0;
    await refreshUsage();
    await page.getByText(/50 of 50 images remaining this month/).waitFor();
    assert.ok(await imageButton.isEnabled());
    generationMode = 'outage';
    await imageButton.click();
    await page.getByRole('alert').filter({ hasText: 'Image generation is temporarily unavailable.' }).waitFor();
    assert.ok(await imageButton.isEnabled());
    generationMode = 'success';
    await imageButton.click();
    await page.getByText(/49 of 50 images remaining this month/).waitFor();
    assert.ok(await page.getByAltText('Generated for your post').isVisible());
    checks += 6;

    failUsage = true;
    await refreshUsage();
    const retry = page.getByRole('button', { name: 'Retry allowance', exact: true });
    await retry.waitFor();
    assert.equal(await page.getByText(/49 of 50 images remaining this month/).count(), 0, 'Unavailable usage must not display a fabricated or stale remaining count');
    assert.ok(await imageButton.isEnabled(), 'Quota fetch failure leaves generation enforcement with the server');
    failUsage = false;
    await retry.click();
    await page.getByText(/49 of 50 images remaining this month/).waitFor();
    checks += 3;

    await auditNavigate(page, base + 'resume-builder?tab=resume');
    await page.getByText(/1 of 30 AI assistance requests remaining this month/).waitFor();
    assert.match(await page.getByRole('status').filter({ hasText: 'AI assistance requests remaining' }).textContent(), /Resets .*UTC/);
    assert.ok(await page.getByText(/Summary, bullet, cover letter, and message requests share one monthly allowance/).isVisible());
    await page.getByRole('button', { name: 'AI Assist', exact: true }).click();
    await page.getByText(/0 of 30 AI assistance requests remaining this month/).waitFor();
    assert.ok(await page.getByRole('button', { name: 'AI Assist', exact: true }).isDisabled());
    assert.ok(await page.getByRole('button', { name: 'AI', exact: true }).isDisabled());
    const contact = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Contact', exact: true }) });
    await contact.locator('input').first().fill('Manually Edited Member');
    await page.getByRole('button', { name: 'Save all changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.equal(savedDrafts.at(-1).data.contact.name, 'Manually Edited Member');
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
    await page.getByText('ATS score 96/100', { exact: true }).waitFor();
    assert.equal(exports.length, 1);
    assert.equal(counts.resume, 30, 'Manual editing, saving and export do not consume AI requests');
    await page.getByRole('tab', { name: 'Cover letter', exact: true }).click();
    assert.ok(await page.getByRole('button', { name: 'Draft cover letter', exact: true }).isDisabled());
    assert.ok(await page.getByRole('button', { name: 'Copy', exact: true }).isEnabled());
    assert.ok(await page.getByRole('button', { name: 'Export PDF', exact: true }).isEnabled());
    await page.getByRole('tab', { name: 'Reach-out messages', exact: true }).click();
    const messageButton = page.getByRole('button', { name: 'Draft message', exact: true });
    assert.ok(await messageButton.isDisabled());
    await page.screenshot({ path: path.join(output, `generation-resume-limit-${width}.png`), fullPage: true });
    checks += 10;

    counts.resume = 29;
    await refreshUsage();
    await page.getByText(/1 of 30 AI assistance requests remaining this month/).waitFor();
    generationMode = 'limit';
    await messageButton.click();
    await page.getByText(/0 of 30 AI assistance requests remaining this month/).waitFor();
    assert.ok(await messageButton.isDisabled(), '429 returned usage immediately exhausts every shared resume control');
    failUsage = true;
    await refreshUsage();
    await retry.waitFor();
    assert.equal(await page.getByText(/0 of 30 AI assistance requests remaining this month/).count(), 0);
    failUsage = false;
    counts.resume = 0;
    await retry.click();
    await page.getByText(/30 of 30 AI assistance requests remaining this month/).waitFor();
    generationMode = 'outage';
    await messageButton.click();
    await page.getByText('AI writing is temporarily unavailable. Please try again shortly.', { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Your reach-out message will appear here.').inputValue(), draft.outreach.body);
    checks += 4;

    generationMode = 'success';
    await page.getByRole('tab', { name: 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'AI Assist', exact: true }).click();
    await page.getByText(/29 of 30 AI assistance requests remaining this month/).waitFor();
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await page.getByText(/28 of 30 AI assistance requests remaining this month/).waitFor();
    await page.getByRole('tab', { name: 'Cover letter', exact: true }).click();
    await page.getByRole('button', { name: 'Draft cover letter', exact: true }).click();
    await page.getByText(/27 of 30 AI assistance requests remaining this month/).waitFor();
    await page.getByRole('tab', { name: 'Reach-out messages', exact: true }).click();
    await messageButton.click();
    await page.getByText(/26 of 30 AI assistance requests remaining this month/).waitFor();
    assert.equal(counts.resume, 4, 'All four AI assistance actions share one counter');
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, [], 'No publishing, billing, or other mutation may escape the synthetic routes');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    checks += 7;
    console.log(`PASS: generation usage, separate media caps, shared resume cap, 429, outages, retry, history and manual editing at ${width}px`);
    await context.close();
  }
  console.log(`PASS: ${checks} generation usage browser checks across desktop and mobile`);
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
