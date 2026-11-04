import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import { returnFromOfficeWelcome } from './office-welcome-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const reportsModule = require('../backend/content-reports');
const { REPORT_TARGET_TEST_SCHEMA } = require('../backend/test-support/report-db');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const pg = new PGlite();
await pg.exec(`CREATE TABLE reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
  reason TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ,resolved_by TEXT);
  CREATE TABLE creator_copyright_reports(id UUID PRIMARY KEY,status TEXT NOT NULL);`);
await pg.exec(REPORT_TARGET_TEST_SCHEMA);
for (const sql of reportsModule.REPORT_SCHEMA) await pg.exec(sql);
let unavailable = false;
const reportDb = { isConnected: () => !unavailable, query: (...args) => pg.query(...args), withClient: fn => fn(pg) };
const token = 'synthetic-office-reports-test';
const app = await createAppHarness({ env: { OFFICE_TOKEN: token }, modules: {
  './content-reports': { ...reportsModule, registerContentReportRoutes: (app, options) => reportsModule.registerContentReportRoutes(app, { ...options, db: reportDb, notifyChildSafety: async () => {} }) },
} });
app.seedUser(member('reports-member'));
const output = path.join(root, '.cache/audit-content-reports');
await fs.mkdir(output, { recursive: true });
const servers = await Promise.all(['web', 'office'].map((directory, index) => createServer({
  root: path.join(root, directory), configFile: path.join(root, directory, 'vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5234 + index, strictPort: false, watch: null, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
})));
let browser, currentPage;
try {
  await Promise.all(servers.map(server => server.listen()));
  const web = servers[0].resolvedUrls.local[0], office = servers[1].resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    await pg.exec('TRUNCATE reports CASCADE; TRUNCATE report_content_suppressions,feed_posts_cache,feed_posts_staging,feed_posts_archive');
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage();
    currentPage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const post = { id: 'report-example', source: 'github', isExternal: true, title: 'A public post', content: 'A reportable post.',
      author: { name: 'Source author' }, sourceUrl: 'https://github.com/example/project', createdAt: new Date().toISOString(), likesCount: 4, commentsCount: 0 };
    await pg.query('INSERT INTO feed_posts_cache(id,source,source_url,title,content,post_created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[post.id,post.source,post.sourceUrl,post.title,post.content,post.createdAt]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/feed/report-example') return route.fulfill({ json: { post } });
      if (endpoint === '/feed/report-example/comments') return route.fulfill({ json: { comments: [] } });
      if (endpoint.startsWith('/office/feed/videos')) return route.fulfill({ json: { posts: [{ ...post, mediaType: 'video', mediaUrl: web + 'synthetic-unavailable.mp4', directPlaybackAuthorized: true, videoDurationSeconds: 30 }], hasMore: false } });
      if (['/feed', '/feed/guest', '/office/feed'].includes(endpoint)) return route.fulfill({ json: { posts: [post], hasMore: false } });
      if (url.pathname.endsWith('synthetic-unavailable.mp4') || /events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'reports-member');
    await page.goto(web + 'p/report-example?audit-public=1');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Report post', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Report post', exact: true });
    await dialog.getByRole('link', { name: 'Copyright notices and counter-notices' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await auditNavigate(page, web + 'p/report-example');
    await page.goto(web + 'p/report-example');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Report post', exact: true }).click();
    await dialog.getByLabel('Copyright or intellectual property', { exact: true }).check();
    await dialog.getByLabel('Additional details (optional)').fill('A private review detail. <img src=x onerror=alert(1)>');
    unavailable = true;
    await dialog.getByRole('button', { name: 'Submit report', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal((await pg.query('SELECT * FROM reports')).rows.length, 0);
    unavailable = false;
    await dialog.getByRole('button', { name: 'Submit report', exact: true }).click();
    await page.getByRole('heading', { name: 'Report submitted', exact: true }).waitFor();
    assert.equal((await pg.query('SELECT * FROM reports')).rows.length, 1);
    assert.equal(await page.getByRole('dialog').locator('img').count(), 0);
    await page.screenshot({ path: path.join(output, `report-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await auditNavigate(page, web + 'global');
    await page.getByRole('button', { name: 'More options', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Report post', exact: true }).waitFor();
    assert.equal(await page.locator('.post-chrome-header').getByRole('button', { name: 'Report post' }).count(), 0);
    await page.keyboard.press('Escape');
    await auditNavigate(page, web + 'videos');
    await page.locator('[data-post-id="report-example"]').getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Report post', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Intimate imagery shared without consent', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.goto(office + '#reports');
    await page.getByLabel('Access token', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    await returnFromOfficeWelcome(page, 'Reports');
    await page.getByRole('button', { name: /Copyright \/ intellectual property/ }).click();
    await page.getByRole('article', { name: 'Selected report' }).getByText('A private review detail. <img src=x onerror=alert(1)>', { exact: true }).waitFor();
    await page.getByLabel('Review note', { exact: true }).fill('Checked original source. Formal notice requested; no removal decision made.');
    await page.getByRole('button', { name: 'Record review and resolve', exact: true }).click();
    await page.getByText('No reports in this queue.', { exact: true }).waitFor();
    await page.getByLabel('Queue', { exact: true }).selectOption('resolved');
    await page.getByRole('button', { name: /Copyright \/ intellectual property/ }).click();
    await page.getByText('open → resolved', { exact: true }).waitFor();
    assert.equal((await pg.query('SELECT * FROM report_review_events')).rows.length, 1);
    for (const [title,linkName] of [['Report on source','Open GitHub to report'],['Contact support','Open support email draft']]) {
      await page.getByRole('button',{name:title,exact:true}).click();
      const confirm=page.getByRole('dialog',{name:title,exact:true});
      await confirm.getByLabel('Action note',{exact:true}).fill(`Verified target and prepared ${title.toLowerCase()} handoff.`);
      await confirm.getByRole('button',{name:'Prepare handoff',exact:true}).click();
      await page.getByRole('link',{name:linkName,exact:true}).waitFor();
      assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length,1,'Preparing a handoff does not remove content');
    }
    await page.getByRole('button',{name:'Remove from UFIConnect',exact:true}).click();
    const removal=page.getByRole('dialog',{name:'Remove from UFIConnect',exact:true});
    await removal.getByLabel('Action note',{exact:true}).fill('Verified stored target and authorized removal from UFIConnect.');
    await removal.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await page.getByText('Content removed from UFIConnect.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/Copyright \/ intellectual property/}).click();
    await page.getByText('This content has already been removed from UFIConnect.',{exact:true}).waitFor();
    assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length,0);
    assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length,1);
    assert.equal((await pg.query('SELECT * FROM report_review_events')).rows.length,4);
    assert.equal(await page.getByRole('button',{name:'Remove from UFIConnect',exact:true}).isDisabled(),true);
    const accountId='a0000000-0000-4000-8000-000000000001';
    await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Reported fixture account','reported@example.invalid') ON CONFLICT(id) DO NOTHING",[accountId]);
    const reportService=reportsModule.createContentReports({db:reportDb});
    await reportService.submit('reports-member',{targetType:'user',targetId:accountId,reason:'harassment'});
    await reportService.submit('reports-member',{targetType:'user',targetId:'missing-account',reason:'harassment'});
    await page.getByLabel('Queue',{exact:true}).selectOption('open');
    await page.locator('.office-report-list button').filter({hasText:`user: ${accountId}`}).click();
    await page.getByRole('link',{name:'Manage reported account',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Manage reported account',exact:true}).getAttribute('href'),`?account=${accountId}#analytics`);
    await page.locator('.office-report-list button').filter({hasText:'user: missing-account'}).click();
    await page.getByText('The reported account could not be verified in stored accounts.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Manage reported account',exact:true}).count(),0);
    await page.getByLabel('Queue',{exact:true}).selectOption('resolved');
    await page.getByRole('button',{name:/Copyright \/ intellectual property/}).click();
    await page.getByText('This content has already been removed from UFIConnect.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `office-reports-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: guest report links, member receipt, storage outage, feed/video controls, protected Office review, audited removal and manual source/support handoffs`);
    await context.close();
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error('Audit page', currentPage.url(), (await currentPage.locator('body').innerText()).slice(0, 2500));
    await currentPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => server.close()));
  await app.close(); await pg.close();
}
