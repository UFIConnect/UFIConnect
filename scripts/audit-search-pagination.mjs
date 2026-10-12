import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const memory = false;
const searchOnly = false;
const output = process.env.UI_AUDIT_OUTPUT ? path.resolve(process.env.UI_AUDIT_OUTPUT) : path.join(root, '.cache/audit-ui/search-jobs-pagination');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
const userId = 'whole-site-fixture';
app.seedUser(member(userId, { name: 'Alex Morgan', title: 'Product Designer', plan: 'pro', resumeBuilderAddon: true,
  bio: 'Connecting with people and discovering what comes next.', skills: ['Design', 'Technology'],
  joinedGroups: ['fixture-group'], onboardingComplete: true }));
const report = { checkedAt: new Date().toISOString(), mode: memory ? 'MemoryRouter source fixture; physical URL held constant' : 'Current shared website source', fixturesOnly: true, liveActions: 0, checks: [], results: [] };
const check = (value, message) => { assert.ok(value, message); report.checks.push(message); };
const observer = `function AuditRouter(){ const navigate=useNavigate(); const location=useLocation(); React.useLayoutEffect(()=>{window.__auditNavigate=navigate;window.__auditLocation=location},[navigate,location]);return null; }`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'isolated-router-observer', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/web/src/main.jsx')) return;
    code = code.replace("import { BrowserRouter } from 'react-router-dom';", "import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';");
    code = code.replace('function OptionalAuth0Provider', observer + '\nfunction OptionalAuth0Provider').replace('<App />', '<AuditRouter /><App />');
    if (memory) code = code.replace('<BrowserRouter basename={import.meta.env.BASE_URL}>', '<MemoryRouter initialEntries={["/settings?tab=security"]}>').replace('</BrowserRouter>', '</MemoryRouter>');
    return code;
  } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const post = { id: 'fixture-post', authorId: 'maya', author: { id: 'maya', name: 'Maya Rivera', title: 'Community builder' },
  source: 'uficonnect', isExternal: false, title: 'A new idea starts with a conversation',
  content: 'Explore communities, share your interests, and discover your next opportunity.', createdAt: new Date().toISOString(), likesCount: 3, commentsCount: 1 };
const group = { id: 'fixture-group', name: 'Design together', description: 'A welcoming space for designers to share ideas.', category: 'Design', createdBy: 'maya', memberCount: 12, isJoined: true };
const jobs = [{ id: 'fixture-job', title: 'Product Designer', org: 'Northstar Studio', type: 'job', source: 'UFIConnect',
  sourceUrl: 'https://example.invalid/job', location: 'Remote', remote: true, tags: ['Full-time', 'Design'], posted: new Date().toISOString(),
  description: 'Build thoughtful digital experiences with a collaborative product team.', fullDescriptionHtml: '<p>Design accessible digital experiences with a collaborative product team.</p>' }];
const fixturePerson = { id: 'maya', name: 'Maya Rivera', title: 'Community builder', bio: 'Designing better communities.', skills: ['Design'], interests: ['Technology'], role: 'Designer / Creative' };
try {
  for (const width of process.env.PAGINATION_WIDTH ? [Number(process.env.PAGINATION_WIDTH)] : [390,820,1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, isMobile: width === 390, hasTouch: width <= 820, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    let failNext = false, emptyNext = false;
    const errors = [], deniedWrites = [], apiErrors = [], assetErrors = [], apiReads = [];
    let businessFixture = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if(response.status() >= 400 && /\.(js|css)(\?|$)/.test(response.url())) assetErrors.push(response.url()); });
    await page.addInitScript(() => {
      localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'); localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
      window.__auditScrollTargets = []; const scroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(...args) { window.__auditScrollTargets.push(this.id); return scroll.apply(this,args); };
    });
    await context.route('**/*', async route => {
      const request=route.request(), url=new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const endpoint=url.pathname.slice(4), fulfill=json => route.fulfill({ json });
        if(request.method()==='GET') apiReads.push(endpoint+url.search);
        if (endpoint === '/auth/session') { const { data: profile }=await app.request('/profile', { userId }); return fulfill({ profile: businessFixture ? {...profile,plan:'business',organization:'Northstar Studio',businessSeats:2} : profile, token: app.token(userId) }); }
        if (endpoint === '/profile' && request.method()==='GET') { const {data:profile}=await app.request('/profile',{userId}); return fulfill(businessFixture?{...profile,plan:'business',organization:'Northstar Studio',businessSeats:2}:profile); }
        if (endpoint === '/business/team/invitations' && request.method() === 'POST') return fulfill({ invitePath: '/settings#invite=synthetic-invitation-only' });
        if (endpoint === '/notifications/mark-read') return fulfill({ok:true});
        if (endpoint.startsWith('/analytics/') || /engagement|\/seen$/.test(endpoint) || ['/errors/client','/posts/engaged'].includes(endpoint)) return fulfill({ok:true});
        if (!['GET','HEAD'].includes(request.method())) { deniedWrites.push(endpoint); return route.fulfill({ status:409,json:{message:'Disabled in isolated UI audit'} }); }
        if (/events|stream/.test(endpoint)) return route.abort();
        if (['/health','/readyz'].includes(endpoint)) return fulfill({ok:true});
        if (endpoint === '/auth/providers') return fulfill({ providers:{} });
        if (endpoint === '/feed/location') return fulfill({automaticLocationAvailable:true,countryCode:'US'});
        
        if (['/feed','/users/search','/groups','/opportunities'].includes(endpoint)) {
          const params=url.searchParams, size=Number(params.get('limit'))||20, cursor=params.get('cursor'), offset=Number(params.get('offset'))||(Number(params.get('page')||1)-1)*size;
          const query=params.get(endpoint==='/opportunities'?'search':'q')||'all';
          if (failNext && offset>0) { failNext=false; return route.fulfill({status:500,json:{error:'Synthetic retry case'}}); }
          const total= query==='empty' ? 0 : size*2+3;
          const count=emptyNext&&offset>0?0:Math.max(0,Math.min(size,total-offset));
          const items=Array.from({length:count},(_,i)=>{const n=String(offset+i+1).padStart(3,'0'), id=query+'-'+n;
            if(endpoint==='/feed')return {...post,id,title:query+' Post '+n,content:query+' Post '+n,createdAt:new Date(Date.UTC(2026,9,1)-Number(n)*60000).toISOString()};
            if(endpoint==='/users/search')return {...fixturePerson,id,name:query+' Person '+n};
            if(endpoint==='/groups')return {...group,id,name:query+' Group '+n};
            return {...jobs[0],id,title:query+' Job '+n,source:'Remotive',isLive:true};
          });
          if (endpoint==='/feed') return fulfill({posts:items,hasMore:count>0&&offset+count<total,cursor:offset+count<total?'cursor-'+(offset+count):'',nativeUficonnectIncluded:true});
          if (endpoint==='/users/search') return fulfill({users:items,hasMore:count>0&&offset+count<total,totalCount:total,registeredCount:total,countSource:'database'});
          if (endpoint==='/groups') return fulfill({groups:items,hasMore:count>0&&offset+count<total,totalCount:total});
          return fulfill({opportunities:items,hasMore:count>0&&offset+count<total,totalCount:total,availableSources:['Remotive','The Muse'],liveCount:total});
        }
        if (endpoint === '/groups/categories') return fulfill({categories:['Design','Technology']});
        if (endpoint === '/office/feed' || endpoint === '/feed' || endpoint === '/search/posts') return fulfill({posts:[post],hasMore:false,nativeUficonnectIncluded:true,waitingForNew:true});
        if (endpoint === '/posts/fixture-post' || endpoint === '/feed/fixture-post') return fulfill({post});
        if (endpoint === '/posts/fixture-post/comments' || endpoint === '/feed/fixture-post/comments') return fulfill({comments:[]});
        if (endpoint === '/saved/posts') return fulfill({posts:[post],postIds:[post.id],hasMore:false});
        if (endpoint === '/jobs/tracking') return fulfill({jobs:jobs.map(job=>({...job,status:'saved'}))});
        if (endpoint === '/auth/providers/linked') return fulfill({providers:[]});
        if (endpoint === '/business/team') return fulfill({role:'owner',active:true,used:1,seats:2,members:[],invitations:[]});
        if (endpoint === '/business/posts') return fulfill({posts:[],hasMore:false});
        if (endpoint === '/groups' || endpoint === '/groups/search') return fulfill({groups:[group],hasMore:false});
        if (endpoint === '/groups/fixture-group') return fulfill({group});
        if (endpoint === '/groups/fixture-group/members') return fulfill({members:[fixturePerson]});
        if (endpoint === '/groups/fixture-group/posts') return fulfill({posts:[{...post,groupId:group.id}],hasMore:false});
        if (endpoint === '/opportunities') return fulfill({opportunities:jobs,hasMore:false,totalCount:1,availableSources:['UFIConnect']});
        if (endpoint === '/users/search') return fulfill({users:[fixturePerson],hasMore:false,totalCount:1,registeredCount:1,countSource:'database'});
        if (endpoint === '/users/maya') return fulfill(fixturePerson);
        if (endpoint === '/users/maya/posts' || endpoint === `/users/${userId}/posts`) return fulfill({posts:[post],hasMore:false});
        if (endpoint === '/messages') return fulfill({conversations:[{id:'maya',participant:fixturePerson,unreadCount:1,lastMessage:{text:'Looking forward to connecting.',createdAt:new Date().toISOString()}}]});
        if (endpoint === '/messages/maya') return fulfill({participant:fixturePerson,messages:[{id:'fixture-message',senderId:'maya',content:'Looking forward to connecting.',createdAt:new Date().toISOString()}]});
        if (endpoint === '/notifications') return fulfill({notifications:[{id:'fixture-notification',type:'like',user:fixturePerson,targetId:post.id,preview:'A new idea starts with a conversation',read:false,createdAt:new Date().toISOString()}]});
        if (endpoint === '/billing/status') return fulfill({});
        if (endpoint === '/resume-builder/draft') return fulfill({template:'modern',data:{name:'Alex Morgan',title:'Product Designer',email:'alex@example.invalid',summary:'Creating accessible digital experiences.',skills:['Design','Research']}});
        if (endpoint === '/generation/usage') return fulfill({period:{startsAt:'2026-10-01T00:00:00Z',resetsAt:'2026-11-01T00:00:00Z'},limits:Object.fromEntries(['image','video','resume'].map(kind=>[kind,{remaining:20,limit:20,used:0}]))});
        const response=await app.request(endpoint+url.search,{userId});
        if(response.status>=400) apiErrors.push({endpoint,status:response.status});
        return route.fulfill({status:response.status,json:response.data??{}});
      }
      if (url.origin === origin) return route.continue();
      if (request.resourceType() === 'image') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c3d7f5"/></svg>'});
      return route.abort();
    });

    async function visit(url) {
      await page.goto(origin+url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__auditNavigate&&!document.querySelector('.splash'),null,{timeout:60000});
    }
    const header=page.getByRole('searchbox',{name:'Search UFIconnect',exact:true});
    const cases=[['posts',30,'.search-post-results .post-card'],['following',30,'.search-post-results .post-card'],['people',24,'.search-person-card'],['groups',24,'.search-group-browser .group-directory-tab'],['jobs',20,'.job-result-tab'],['standalone-jobs',20,'.job-result-tab']];
    for (const [tab,size,selector] of cases) {
      if(process.env.PAGINATION_CASE && !process.env.PAGINATION_CASE.split(',').includes(tab))continue;
      console.log('CHECK '+width+' '+tab);
      const standalone=tab==='standalone-jobs',url=standalone?'/opportunities?q=design':'/search?tab='+tab+'&q=design';
      await visit(url);
      const pager=page.getByRole('navigation',{name:tab.endsWith('jobs')?'Job results pages':'Search results pages',exact:true});
      const ready=async n=>{await page.waitForFunction(({label,n})=>{const el=document.querySelector('nav[aria-label="'+label+'"]');return el?.getAttribute('aria-busy')==='false'&&el.querySelector('[aria-current="page"]')?.textContent.startsWith('Page '+n)},{label:tab.endsWith('jobs')?'Job results pages':'Search results pages',n});};
      await ready(1);
      const items=page.locator(selector);
      await items.first().waitFor();
      check(await items.count()===size,tab+' first page contains exactly '+size+' rows at '+width);
      check(await pager.getByRole('button',{name:'Previous'}).isDisabled(),tab+' Previous is disabled on first page at '+width);
      check(await header.isVisible()&&await page.locator('input[type="search"]').count()===1,tab+' retains one functional header query at '+width);
      if(tab==='posts'||tab==='following') check(!/ of \d/.test(await pager.innerText()),tab+' does not invent a total for cursor results at '+width);
      await pager.getByRole('button',{name:'Next'}).click(); await ready(2);
      await page.waitForTimeout(50);
      const scrollTarget=standalone?'.jobs-page-layout':tab==='jobs'?'.jobs-page-content--embedded':'.search-tab-strip';
      const position=await page.evaluate(sel=>({target:document.querySelector(sel)?.getBoundingClientRect().top,header:document.querySelector('.global-app-header')?.getBoundingClientRect().bottom}),scrollTarget);
      check(position.target>=position.header-1,tab+' page change keeps the result heading below the fixed header at '+width+' ('+position.target+'/'+position.header+')');
      check(await items.count()===size && (await items.first().innerText()).includes(String(size+1).padStart(3,'0')),tab+' Next replaces page 1 with page 2 at '+width);
      if(tab==='posts'||tab==='following') check(apiReads.some(x=>x.startsWith('/feed?')&&new URLSearchParams(x.split('?')[1]).get('cursor')==='cursor-30'),tab+' sends the cursor returned by the previous page at '+width);
      await pager.getByRole('button',{name:'Next'}).click(); await ready(3);
      await page.waitForTimeout(550);
      check((await pager.locator('[aria-current="page"]').innerText()).startsWith('Page 3'),tab+' short final page remains selected after automatic scroll at '+width);
      check(await items.count()===3,tab+' final page contains its remaining rows at '+width);
      check(await pager.getByRole('button',{name:'Next'}).isDisabled(),tab+' Next is disabled at the actual end at '+width);
      await pager.getByRole('button',{name:'Previous'}).click(); await ready(2);
      check(await items.count()===size,tab+' Previous restores the prior successful page at '+width);
      await header.fill('updated'); await header.press('Enter'); await ready(1);
      await page.waitForFunction(sel=>document.querySelector(sel)?.textContent.includes('updated'),selector);
      check((await items.first().innerText()).includes('001'),tab+' header query resets results to page 1 at '+width);
      check(await pager.getByRole('button',{name:'Previous'}).isDisabled(),tab+' new query clears page history at '+width);
      if(width===390) {
        failNext=true; await pager.getByRole('button',{name:'Next'}).click();
        const retry=page.getByRole('button',{name:tab.endsWith('jobs')?'Retry':'Try again',exact:true}); await retry.waitFor();
        check(await items.count()===size && (await items.first().innerText()).includes('001'),tab+' failed Next retains the visible page');
        await retry.click(); await ready(2); check((await items.first().innerText()).includes(String(size+1).padStart(3,'0')),tab+' Retry retries the failed page');
        if(tab==='people') { await page.getByLabel('Sort people').selectOption('followers'); await ready(1); check(true,'People sort resets the page'); }
        else if(tab==='groups') { await page.getByRole('group',{name:'Filter groups by category'}).getByRole('button',{name:'Design',exact:true}).click(); await ready(1); check(true,'Group category resets the page'); }
        else if(tab==='posts'||tab==='following') { await page.getByRole('group',{name:'Filter posts by topic'}).getByRole('button').nth(1).click(); await ready(1); check(true,tab+' topic filter resets the page'); }
        else if(tab==='jobs') { await page.getByRole('button',{name:'Remote',exact:true}).click(); await ready(1); check(true,'Embedded Jobs remote filter resets the page'); }
        else { await page.evaluate(()=>window.__auditNavigate('/opportunities?q=updated&work=remote')); await ready(1); check(true,'Standalone Jobs route filter resets the page'); }
        emptyNext=true; await pager.getByRole('button',{name:'Next'}).click(); await ready(1);
        check(await items.count()===size&&await pager.getByRole('button',{name:'Next'}).isDisabled(),tab+' empty next page retains populated results and stops paging'); emptyNext=false;
        await header.fill('empty'); await header.press('Enter'); await ready(1);
        await page.waitForFunction(sel=>document.querySelectorAll(sel).length===0,selector);
        check(await pager.getByRole('button',{name:'Next'}).isDisabled(),tab+' empty search has no phantom next page');
        await header.fill('design'); await header.press('Enter'); await ready(1);
      }
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,tab+'-'+width+'.png')});
      const measure=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,shell:document.querySelector('.search-page-shell')?.getBoundingClientRect().width,main:document.querySelector('main')?.getBoundingClientRect().width}));
      check(measure.scroll<=width+2,tab+' fits viewport '+width);
      if(!standalone&&width===1440) check(measure.shell>850,tab+' uses the wider desktop page ('+Math.round(measure.shell)+'px)');
      await pager.scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(output,tab+'-pager-'+width+'.png')});
      check(await pager.getByRole('button',{name:'Previous'}).isVisible()&&await pager.getByRole('button',{name:'Next'}).isVisible(),tab+' page controls are visible and within layout at '+width);
      report.results.push({tab,width,passed:true,measure});
    }
    await visit('/profile'); await page.locator('.profile-header').waitFor();
    await header.fill('design'); await header.press('Enter'); await page.locator('.global-search-dialog .search-query-input').waitFor();
    check(true,'Embedded global search retains its own query at '+width);
    check(errors.length===0,'No page exceptions at '+width+': '+errors.join(';'));
    check(deniedWrites.length===0,'No live or unexpected mutation attempts at '+width);
    await context.close();
  }
  report.passed=true;
  console.log(JSON.stringify({passed:true,checks:report.checks.length,output}));
} catch(error) { report.passed=false; report.error=error.stack; throw error; }
finally { await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n'); await browser.close(); await server.close(); await app.close(); }
