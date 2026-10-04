import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { publicRoutes, memberRoutes, dynamicRoutes, redirectRoutes } from '../web/src/seo-routes.mjs';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  if (named[entity]) return named[entity];
  return String.fromCodePoint(entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1)));
});
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3])]));
const stripTags = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
// The approved Google tag uses two small queue-initialization snippets. Keep
// the exception exact and require their hashes in CSP; other inline code fails.
const approvedGoogleSnippets = new Set([
  "window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'AW-18490754953');",
  "gtag('event', 'conversion', {'send_to': 'AW-18490754953/s7sWCK_AsI4dEImPivFE'});",
]);
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

await fs.mkdir(output, { recursive: true });
const server = await startBuiltServer({ port: 0 });
let browser;
const pages = new Map();
try {
  const { origin } = server;
  async function readPage(route, options = {}) {
    const response = await fetch(origin + route, { signal: AbortSignal.timeout(10000), ...options });
    return { response, html: await response.text() };
  }
  for (const route of publicRoutes) {
    const { response, html } = await readPage(route.path);
    check(response.status === 200, `${route.path}: public page must return 200`);
    check(/text\/html/i.test(response.headers.get('content-type')), `${route.path}: HTML MIME type`);
    check(/<div\b[^>]*id="root"[^>]*>[\s\S]*<h1\b/i.test(html), `${route.path}: meaningful heading must be present in raw HTML`);
    check(!/<div\b[^>]*id="root"[^>]*>\s*<\/div>/.test(html), `${route.path}: SPA root must not be empty`);
    const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
    check(titles.length === 1 && stripTags(titles[0][1]) === route.title, `${route.path}: one correct server-rendered title`);
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
    const descriptions = meta.filter(item => item.name === 'description');
    check(descriptions.length === 1 && descriptions[0].content === route.description, `${route.path}: one descriptive page summary`);
    const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(item => item.rel === 'canonical');
    check(canonicals.length === 1 && canonicals[0].href === `https://uficonnect.org${route.path}`, `${route.path}: one route-specific canonical URL`);
    const robots = meta.find(item => item.name === 'robots')?.content || '';
    check(route.index ? !/noindex/.test(robots) : /noindex/.test(robots), `${route.path}: account utility indexing policy`);
    const scriptPolicy = response.headers.get('content-security-policy')?.split(';').find(value => value.trim().startsWith('script-src '));
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = attributes(match[1]);
      if (attrs.type === 'application/ld+json' || attrs.type === 'application/json') continue;
      if (attrs.src) {
        check(attrs.type === 'module' || /\b(?:defer|async)(?:\s|=|$)/i.test(match[1]), `${route.path}: external classic scripts must defer or load asynchronously`);
      } else {
        const source = match[2].replace(/\r\n?/g, '\n');
        check(approvedGoogleSnippets.has(source.replace(/\s+/g, ' ').trim()), `${route.path}: inline scripts must match the approved Google initialization`);
        const hash = createHash('sha256').update(source).digest('base64');
        check(scriptPolicy?.includes(`'sha256-${hash}'`), `${route.path}: approved inline script must be authorized by its exact CSP hash`);
      }
    }
    check(Boolean(scriptPolicy) && !/unsafe-inline|unsafe-eval/.test(scriptPolicy), `${route.path}: production CSP keeps unsafe scripts blocked`);
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)].map(match => new URL(decode(match[1]), origin));
    pages.set(route.path, { html, links });
  }
  check(new Set(publicRoutes.map(route => route.title)).size === publicRoutes.length, 'Public pages have distinct titles');

  const sitemap = await readPage('/sitemap.xml');
  check(sitemap.response.status === 200, 'Sitemap is served');
  const sitemapPaths = [...sitemap.html.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => {
    const url = new URL(decode(match[1]));
    check(url.origin === 'https://uficonnect.org', 'Sitemap uses the public HTTPS origin');
    return url.pathname;
  });
  assert.deepEqual([...sitemapPaths].sort(), publicRoutes.filter(route => route.index).map(route => route.path).sort());
  checks++;
  for (const route of sitemapPaths) {
    check(pages.has(route), `${route}: sitemap destination returns a public HTML page`);
    check([...pages].some(([from, page]) => from !== route && page.links.some(link => [origin, 'https://uficonnect.org'].includes(link.origin) && link.pathname === route)), `${route}: sitemap page is linked from another public page`);
  }
  for (const route of ['/seo-checker-not-found-page', '/nested/page/that-does-not-exist', '/groups/example/nonexistent-child', '/assets/does-not-exist.js']) {
    const { response, html } = await readPage(route);
    check(response.status === 404, `${route}: missing URLs must return a real 404`);
    if (!route.startsWith('/assets/')) {
      check(/<h1\b/i.test(html) && /page not found/i.test(html), `${route}: helpful not-found HTML`);
      check(/href="\/(?:global|search|login)"/.test(html), `${route}: not-found page offers useful next steps`);
    }
  }
  for (const pattern of dynamicRoutes) {
    const route = pattern.replace(/:[^/]+/g, 'seo-audit-example');
    const { response, html } = await readPage(route);
    check(response.status === 200 && /id="root"/.test(html), `${route}: valid shared/member route still boots`);
    check(/name="robots"[^>]*content="noindex/.test(html), `${route}: generic dynamic shell is not indexed as content`);
  }
  for (const route of memberRoutes) {
    const { response, html } = await readPage(route);
    check(response.status === 200 && /id="login-password"/.test(html), `${route}: private page exposes only a sign-in shell before JavaScript`);
    check(/name="robots"[^>]*content="noindex/.test(html), `${route}: member shell stays out of search indexes`);
  }
  for (const rule of redirectRoutes) {
    const { response } = await readPage(rule.source, { redirect: 'manual' });
    check([301, 308].includes(response.status) && new URL(response.headers.get('location'), origin).pathname === rule.destination, `${rule.source}: legacy URL redirects correctly`);
  }
  const privateMarker = 'SEO_AUDIT_PRIVATE_SESSION_SENTINEL';
  const marked = await readPage('/login?token=' + privateMarker, { headers: { Cookie: 'session=' + privateMarker, Authorization: 'Bearer ' + privateMarker } });
  check(marked.html === pages.get('/login').html && !marked.html.includes(privateMarker), 'Static documents neither personalize nor reflect credentials from requests');

  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    for (const route of publicRoutes) {
      await page.goto(origin + route.path, { waitUntil: 'load' });
      const heading = page.locator('h1').first();
      check(await heading.isVisible() && Boolean((await heading.innerText()).trim()), `${route.path} at ${width}px: heading is readable without JavaScript`);
      check(await page.locator('main p, main li, .public-page-guidance p').count() > 0, `${route.path} at ${width}px: supporting content is rendered`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${route.path} at ${width}px: no horizontal overflow`);
      const navigation = await page.locator('a[href]').evaluateAll((elements, publicPaths) => [...new Set(elements.filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && Boolean((element.innerText || element.getAttribute('aria-label') || '').trim())).map(element => new URL(element.href).pathname).filter(value => publicPaths.includes(value)))], publicRoutes.map(item => item.path));
      check(navigation.filter(destination => destination !== route.path).length >= 2, `${route.path} at ${width}px: useful labeled public navigation is available without JavaScript`);
      const forms = page.locator('form');
      if (await forms.count()) {
        check(await page.locator('form input, form select, form textarea, form button').evaluateAll(elements => elements.every(element => element.matches(':disabled'))), `${route.path} at ${width}px: uninitialized forms cannot submit credentials`);
        check(await page.locator('form noscript').first().isVisible(), `${route.path} at ${width}px: form gives a no-JavaScript explanation`);
      }
      if (width === 320 && ['/', '/login', '/search', '/global'].includes(route.path)) await page.screenshot({ path: path.join(output, `seo-nojs-${route.page}-${width}.png`), fullPage: true });
    }
    await context.close();
  }

  const requests = [];
  const errors = [];
  let holdSession = false;
  const heldSessions = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(marker => {
    localStorage.setItem('pc_token', marker);
    localStorage.setItem('ufi_profile_snapshot', JSON.stringify({ name: marker, email: marker + '@example.invalid' }));
  }, privateMarker);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
    const apiRequest = /^\/(api|fallback)\//.test(url.pathname) || ['xhr', 'fetch'].includes(request.resourceType());
    if (!apiRequest) return url.origin === origin ? route.continue() : route.abort();
    requests.push({ endpoint, method: request.method(), body: request.postData(), url: request.url() });
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (endpoint.endsWith('/auth/session')) {
      if (holdSession) await new Promise(resolve => heldSessions.push(resolve));
      return route.fulfill({ status: 401, headers, json: { message: 'Sign in required' } });
    }
    if (endpoint.endsWith('/auth/login')) return route.fulfill({ status: 401, headers, json: { message: 'Audit credentials were rejected.' } });
    if (endpoint.endsWith('/feed/guest')) return route.fulfill({ headers, json: { posts: [], hasMore: false, nextCursor: null } });
    if (/events|stream/.test(endpoint)) return route.abort();
    return route.fulfill({ headers, json: { ok: true } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email:not(:disabled)').waitFor();
  await page.locator('#login-email').fill('seo-audit@example.invalid');
  await page.locator('#login-password').fill('test-only-password-not-a-real-secret');
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('alert').filter({ hasText: 'Audit credentials were rejected.' }).waitFor();
  const loginRequest = requests.find(request => request.endpoint.endsWith('/auth/login') && request.method === 'POST');
  check(Boolean(loginRequest), 'Live login form submits through the mocked API after JavaScript boots');
  check(!requests.some(request => request.url.includes('seo-audit@example.invalid') || request.url.includes('test-only-password')), 'Credentials stay out of request URLs');
  check(await page.evaluate(() => !localStorage.getItem('pc_token') && !localStorage.getItem('ufi_profile_snapshot')), 'Legacy member credentials are cleared before public UI boots');
  check(!(await page.locator('body').innerText()).includes(privateMarker), 'Public UI never renders legacy private member data');

  await page.goto(origin + '/register', { waitUntil: 'domcontentloaded' });
  await page.locator('#register-name:not(:disabled)').waitFor();
  await page.locator('#register-name').fill('SEO Audit');
  await page.locator('#register-email').fill('seo-audit@example.invalid');
  for (const id of ['register-password', 'register-confirm-password']) await page.locator('#' + id).fill('a unique testing passphrase');
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: 'Who are you professionally?' }).waitFor();
  check(!requests.some(request => request.endpoint.endsWith('/auth/register')), 'Registration advances interactively without creating a real account');

  for (const route of ['/', '/search', '/global', '/seo-checker-not-found-page']) {
    const sessionCheck = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/session'));
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await sessionCheck;
    await page.locator('h1').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.splash'));
    await page.waitForFunction(() => Boolean(document.title.trim()));
    check(await page.locator('h1').first().isVisible(), `${route}: JavaScript app preserves useful page content`);
    const metadata = { titles: await page.locator('title').allTextContents(), descriptions: await page.locator('meta[name="description"]').count() };
    check(metadata.titles.length === 1 && metadata.descriptions <= 1, `${route}: JavaScript does not duplicate page metadata (${JSON.stringify(metadata)})`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${route}: JavaScript mobile view fits`);
    if (route === '/search') check(await page.getByRole('link', { name: 'Sign in to search', exact: true }).isVisible(), 'Guest search provides a working sign-in route');
    if (route.includes('not-found')) check(/page not found/i.test(await page.title()), 'JavaScript preserves the not-found page');
  }
  await page.getByRole('link', { name: 'Search guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Find posts, people, groups and jobs', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Sign in to search', exact: true }).click();
  await page.locator('#login-email:not(:disabled)').waitFor();
  check(new URL(page.url()).pathname === '/login' && await page.locator('title').count() === 1 && await page.locator('meta[name="description"]').count() === 1, 'Client-side route changes keep a single correct set of page metadata');

  holdSession = true;
  const sessionStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/auth/session'));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await sessionStarted;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check(await page.getByRole('status').filter({ hasText: 'Opening UFIconnect' }).isVisible(), 'Neutral startup remains visible while session restoration waits on the API');
  check(!await page.locator('.landing-hero-refined').isVisible(), 'A pending saved session never flashes the public homepage');
  const sessionFinished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/session'));
  holdSession = false;
  heldSessions.splice(0).forEach(resolve => resolve());
  await sessionFinished;
  check(!requests.some(request => request.endpoint === '/profile'), 'Guest route rendering does not request private profile data');
  assert.deepEqual(errors, [], 'Built public pages must boot without JavaScript crashes');
  checks++;
  await context.close();
  console.log(`PASS: ${checks} public SEO checks: raw HTML, internal links, true 404s, protected forms, mobile/desktop without JavaScript, and interactive boot.`);
} finally {
  await browser?.close();
  await server.close();
}
