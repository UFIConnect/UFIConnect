import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.EXPO_EXPORT_DIR || path.join(root, '.cache/export-sdk57');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw new Error('Invalid file');
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const key = 'uficonnect.app.preferences.v1';
const profile = {id:'private-member',name:'Private Name',email:'private@example.invalid',onboardingComplete:true,joinedGroups:[],skills:[],connectedPlatforms:[]};
let browser, checks = 0;
const check = (value, message) => {assert.ok(value,message);checks++;};
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:process.platform === 'win32' ? 'msedge' : undefined});
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:844}});
    const page = await context.newPage(), requests = [], google = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base) return route.continue();
      if (/google-analytics|googletagmanager/.test(url.hostname)) {google.push(url.href);return route.abort();}
      if (url.origin !== 'https://api.uficonnect.org') return route.abort();
      const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
      if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers});
      requests.push({path:url.pathname,body:request.postDataJSON(),headers:request.headers()});
      if (url.pathname.startsWith('/analytics/')) return route.fulfill({status:204,headers});
      const data = url.pathname === '/auth/login' ? {token:'private-session',profile} : url.pathname === '/profile' ? {profile}
        : {users:[],posts:[],jobs:[],opportunities:[],groups:[],categories:[],connectedPlatforms:[]};
      return route.fulfill({headers,json:data});
    });
    const required = () => requests.filter(request => request.path === '/analytics/pageview');
    const optional = () => requests.filter(request => request.path === '/analytics/performance');
    const feedRequests = () => requests.filter(request => ['/feed','/social/feed','/social/jobs'].includes(request.path));
    await page.goto(base);
    await page.getByRole('button',{name:'Decline analytics',exact:true}).waitFor();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Password"]'));
    await page.getByRole('button',{name:'Decline analytics',exact:true}).click();
    await Promise.all([
      page.waitForRequest(request=>request.url().endsWith('/analytics/pageview') && request.postDataJSON()?.category === 'app_privacy'),
      page.getByRole('button',{name:'Data & privacy',exact:true}).click(),
    ]);
    const performance = page.getByRole('switch',{name:'Performance insights',exact:true});
    await performance.waitFor();
    check(!(await performance.isChecked()),'Optional performance insights default off');
    check(await page.getByText('Required service metrics',{exact:true}).isVisible(),'Required collection disclosed');
    check(await page.getByRole('switch').count() === 1,'Only the functional performance setting is offered');
    check(await page.getByText('Feed data use',{exact:true}).isVisible(),'Group-only feed data use is disclosed');
    check(required().some(request=>request.body.category==='app_login'),'Required screen count sent before Google consent');
    const beforeState = required().length;
    await page.evaluate(()=>window.dispatchEvent(new window.ErrorEvent('error',{message:'private error before opt-in'})));
    check(optional().length === 0,'Performance stays off by default');
    await performance.check();
    await page.waitForFunction(storageKey => JSON.parse(localStorage.getItem(storageKey))?.performanceInsights === true,key);
    const captured = page.waitForResponse(response => response.url().endsWith('/analytics/performance') && response.request().method() === 'POST');
    await page.evaluate(()=>window.dispatchEvent(new window.ErrorEvent('error',{message:'Private message and account private-member',filename:'https://example.invalid/private?token=secret'})));
    await captured;
    check(optional().length === 1,'Opt-in activates the real error collector');
    check(JSON.stringify(optional()[0].body) === JSON.stringify({category:'app_privacy',kind:'client_error',code:'script_error'}),'Only fixed error fields sent');
    check(required().length === beforeState,'Preference changes do not recount the current screen');
    const otherPage = await context.newPage();
    await otherPage.goto(base);
    await otherPage.getByRole('button',{name:'Data & privacy',exact:true}).click();
    const otherPerformance = otherPage.getByRole('switch',{name:'Performance insights',exact:true});
    check(await otherPerformance.isChecked(),'A second tab restores the saved optional preference');
    await performance.uncheck();
    await page.waitForFunction(storageKey => JSON.parse(localStorage.getItem(storageKey))?.performanceInsights === false,key);
    await otherPage.waitForFunction(() => document.querySelector('input[aria-label="Performance insights"]')?.checked === false);
    check(!(await otherPerformance.isChecked()),'Withdrawing in one tab updates the other tab');
    await otherPage.evaluate(async()=>{
      window.dispatchEvent(new Event('unhandledrejection'));
      await new Promise(resolve=>requestAnimationFrame(resolve));
    });
    await page.evaluate(()=>window.dispatchEvent(new Event('unhandledrejection')));
    check(optional().length === 1,'Withdrawal stops further error collection');
    await otherPage.close();
    check(google.length === 0,'Google remains off while required and optional first-party counts work');
    await page.reload();
    await page.getByRole('button',{name:'Data & privacy',exact:true}).click();
    await performance.waitFor();
    check(!(await performance.isChecked()),'Performance withdrawal survives restart');
    await page.getByRole('link', { name: /Go back|, back/i }).first().click();
    await page.getByPlaceholder('you@example.com').fill(profile.email);
    await page.getByLabel('Password',{exact:true}).fill('Private synthetic password');
    await page.getByText('Sign in',{exact:true}).click();
    await page.getByPlaceholder('Search jobs, gigs, grants, events...').waitFor();
    await page.getByRole('tab',{name:'Feed'}).click();
    await page.getByText('No posts yet',{exact:true}).waitFor();
    check(JSON.stringify(feedRequests().map(request=>request.path)) === JSON.stringify(['/feed']),'The working group feed is the only feed downloaded');
    await page.getByRole('tab',{name:'Profile'}).click();
    await page.getByRole('button',{name:'Data & privacy',exact:true}).click();
    const beforeNormal = feedRequests().length;
    await page.getByRole('link', { name: /Go back|, back/i }).first().click();
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/feed')),page.getByRole('tab',{name:'Feed'}).click()]);
    check(feedRequests().length === beforeNormal + 1,'Returning to Feed refreshes group posts without demo provider downloads');
    for (const request of [...required(),...optional()]) {
      check(!request.headers.authorization && !request.headers.cookie && !request.headers.referer,'Metrics omit credentials and referrer');
      check(!JSON.stringify(request.body).includes('private') && !JSON.stringify(request.body).includes('secret'),'Metrics exclude content and identifiers');
    }
    check(errors.length === 0,`No runtime errors: ${errors.join(';')}`);
    await context.close();
    console.log(`PASS: mobile data and privacy behaviors at ${width}px`);
  }
  console.log(`Mobile preferences export audit: ${checks} checks passed.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
