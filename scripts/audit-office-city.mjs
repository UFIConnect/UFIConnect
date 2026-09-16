import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.city.invalid';
const PIPELINE = 'https://pipeline.city.invalid';
const TOKEN = 'synthetic-city-audit-token';
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(PIPELINE) },
  server: { host: '127.0.0.1', port: 5218, strictPort: false },
});
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

function agent(id, name, role, overrides = {}) {
  const now = new Date().toISOString();
  return { id, name, executionRole:id==='stability'?'both':role, emoji: id.slice(0, 2).toUpperCase(), color: '#60a5fa', interval: '30s',
    description: `${role} runtime agent`, postCount: 27, lastFetch: now,
    health: {status:'healthy',lastSuccess:now,lastAttempt:now,fetchCount:12,consecutiveErrors:0,totalErrors:0,paused:false},
    lastAction: {agentId:id,ts:now,msg:`${role} completed a measured pass`}, logs:[], ...overrides };
}

function status(role, missing = false) {
  const now = new Date().toISOString();
  if (missing) return {server:{serviceRole:role,uptime:60000,db:'connected'}};
  return {
    server:{serviceRole:role,uptime:60000,db:'connected',dbBackup:true},
    feed:{postCount:role==='api'?4000:812,sseClients:3,refreshedAt:now},
    sources:{total:2,healthy:2,paused:0,starting:0,workers:[{id:'reddit',name:'Reddit Agent',status:'healthy',lastSuccess:now}]},
    agents:{active:2,logSize:2},
    equalizer:{pendingTotal:12,lastRun:now,totalRuns:7,totalDrained:180,totalAccepted:160},
    filterAgent:{status:'running',lastRun:now,lastInput:19,lastOutput:17,totalInput:190,totalOutput:170},
    sortAgent:{status:'running',lastRun:now,lastInput:17,lastOutput:16,totalItems:160},
    refreshQueue:{running:true,pending:5,currentIds:['reddit'],batchTotal:3,batchDone:1,lastStarted:now},
    staging:{pendingCount:37,inFlight:true,lastRun:now,lastCount:17,totalTransferred:1234,lastError:null},
    topicFilterAgent:{status:'healthy',lastRun:now,totalRuns:20,lastInput:17,lastOutput:12},
    dbSize:{mb:120,limitMb:5120,status:'ok',usedPct:2},
  };
}

function installFixture(context) {
  const state = {apiFailure:false,pipelineFailure:false,wrongPipelineRole:false,holdStatus:false,missing:false,chatMode:'answer',requests:[],chatRequests:[],held:[],heldStatus:[]};
  return context.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url());
    if (![API,PIPELINE].includes(url.origin)) return route.continue();
    const role=url.origin===API?'api':'pipeline';
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'x-office-token,content-type,accept','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    check(!url.searchParams.has('token') && !url.href.includes(TOKEN),'Office credentials never appear in a URL');
    if (request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    state.requests.push({role,path:url.pathname,method:request.method(),headers:request.headers()});
    check(!request.headers().cookie,'Office requests omit browser cookies');
    if (request.headers()['x-office-token']!==TOKEN) return route.fulfill({status:401,headers,json:{error:'Unauthorized'}});
    if (url.pathname==='/office/status') {
      if (state.holdStatus) {state.heldStatus.push(()=>route.fulfill({headers,json:status(role,state.missing)}).catch(()=>{}));return;}
      if ((role==='api'&&state.apiFailure)||(role==='pipeline'&&state.pipelineFailure)) return route.fulfill({status:503,headers,json:{error:'Synthetic service unavailable'}});
      return route.fulfill({headers,json:status(role==='pipeline'&&state.wrongPipelineRole?'api':role,state.missing)});
    }
    if (url.pathname==='/office/agents') return route.fulfill({headers,json:{agents:role==='api'
      ? {stability:agent('stability','Stability Guard',role),web_optimizer:agent('web_optimizer','Website Optimizer',role)}
      : {stability:agent('stability','Stability Guard',role),reddit:agent('reddit','Reddit Agent',role)}}});
    if (url.pathname.endsWith('/stream')) return route.fulfill({headers,contentType:'text/event-stream',body:`data: ${JSON.stringify({backlog:[{agentId:'stability',ts:new Date().toISOString(),msg:`${role} measured activity`}]})}\n\n`});
    const chat = url.pathname.match(/^\/office\/agents\/([a-z0-9_-]+)\/chat$/);
    if (chat && request.method()==='POST') {
      const body=request.postDataJSON();
      state.chatRequests.push({role,id:chat[1],body});
      check(typeof body.message==='string' && body.message.length>0,'Chat sends the entered message');
      check(Object.keys(body).every(key=>['message','history'].includes(key)),'Chat body contains only the documented conversation fields');
      if (state.chatMode==='unknown') return route.fulfill({status:404,headers,json:{error:'Unknown agent'}});
      if (state.chatMode==='failed') return route.fulfill({status:503,headers,json:{error:'Agent chat temporarily unavailable'}});
      const json={agentId:chat[1],serviceRole:role,mode:state.chatMode==='ai'?'ai':'diagnostics',
        reply:state.chatMode==='slow'?'Late reply from the previous agent':`${role.toUpperCase()} diagnostic reply: AI is unavailable. <img src=x onerror="window.cityXss=true">`,
        observedAt:new Date().toISOString(),suggestions:['What is your current status?']};
      if (state.chatMode==='slow') {state.held.push(()=>route.fulfill({headers,json}).catch(()=>{}));return;}
      return route.fulfill({headers,json});
    }
    if (url.pathname==='/office/post-pipeline') return route.fulfill({headers,json:{posts:[],stats:{},coverage:{retentionDays:7,maxEvents:10000},tracker:{},serviceRole:role}});
    return route.fulfill({headers,json:{agents:{}}});
  }).then(()=>state);
}

async function eventually(predicate, message, timeout = 8000) {
  const deadline=Date.now()+timeout;
  while (Date.now()<deadline) {
    if (await predicate()) return;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.fail(message);
}

async function auditWidth(browser, width) {
  const context=await browser.newContext({viewport:{width,height:950},isMobile:width<600,hasTouch:width<600});
  await context.addCookies([API,PIPELINE].map(origin=>({name:'private_fixture_cookie',value:'synthetic-private-cookie',url:origin,secure:true,sameSite:'None'})));
  await context.addInitScript(()=>{
    localStorage.setItem('ufi_office_token','legacy-must-be-deleted');
    sessionStorage.setItem('ufi_office_token','legacy-must-be-deleted');
  });
  const fixture=await installFixture(context);
  const page=await context.newPage(), errors=[], aborted=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('requestfailed',request=>{if(request.url().endsWith('/chat'))aborted.push(request.url());});
  try {
    await page.goto(server.resolvedUrls.local[0]+'#city',{waitUntil:'domcontentloaded'});
    await page.getByLabel('Access token',{exact:true}).fill(TOKEN);
    await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
    const city=page.getByTestId('live-city');
    await city.waitFor();
    const motion=city.locator('[data-motion]');
    await eventually(async()=>await motion.getAttribute('data-motion')==='active','Fresh measured activity must animate');
    await page.screenshot({path:path.join(root,`.cache/audit-ui/office-city-initial-${width}.png`),fullPage:false});
    check(fixture.requests.some(request=>request.role==='api'&&request.path==='/office/status'),'API status fetched from API origin');
    check(fixture.requests.some(request=>request.role==='pipeline'&&request.path==='/office/status'),'Pipeline status fetched from its own origin');
    async function verifyMobileInspector() {
      if (width>=760) return;
      let previousTop=null, stable=0, visible=false;
      await eventually(async()=> {
        const position=await city.locator('.lc-inspector').evaluate(element=> {
          const navigation=document.querySelector('nav[aria-label="Office sections"]')?.closest('aside');
          const heading=element.querySelector('.lc-inspector-header h2')?.getBoundingClientRect();
          const headerBottom=navigation&&getComputedStyle(navigation).position==='sticky'?navigation.getBoundingClientRect().bottom:0;
          return {top:element.getBoundingClientRect().top,headingTop:heading?.top,headingBottom:heading?.bottom,headerBottom,height:innerHeight,focused:document.activeElement===element};
        });
        stable=previousTop!=null&&Math.abs(position.top-previousTop)<1?stable+1:0;
        previousTop=position.top;
        visible=stable>=3&&position.focused&&position.headingTop>=position.headerBottom&&position.headingBottom<=position.height;
        return visible;
      },'Selected agent heading must settle below the sticky Office header without test scrolling');
      check(visible,'Mobile selection focuses and reveals the inspector heading below the actual sticky header');
    }
    const chooseAgent=async(id,role)=> {
      await city.locator(`button[data-agent-id="${id}"][data-service="${role}"]`).first().click();
      await verifyMobileInspector();
    };
    check(await city.locator('button[data-agent-id="stability"][data-service="api"]').count()>0,'API guard remains inspectable');
    check(await city.locator('button[data-agent-id="stability"][data-service="pipeline"]').count()>0,'Pipeline guard remains inspectable separately');
    check(await city.locator('.lc-road[data-active="true"] .lc-road-flow').evaluateAll(elements=>elements.some(element=>getComputedStyle(element).animationName!=='none')),'Actual CSS motion follows measured activity');
    await page.getByRole('button',{name:'Pause motion',exact:true}).click();
    await eventually(async()=>await motion.getAttribute('data-motion')==='paused','Pause control must stop the city');
    check(await city.locator('.lc-road-flow').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).animationName==='none'||getComputedStyle(element).animationPlayState==='paused')),'Pausing stops actual CSS road animation');
    await page.getByRole('button',{name:'Resume motion',exact:true}).click();
    await eventually(async()=>await motion.getAttribute('data-motion')==='active','Resume restores measured motion');
    const geometry=()=>city.locator('.lc-canvas svg').evaluate(element=>JSON.stringify({viewBox:element.getAttribute('viewBox'),style:element.getAttribute('style'),transforms:[...element.querySelectorAll('[transform]')].map(node=>node.getAttribute('transform'))}));
    const initialGeometry=await geometry();
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    check(await geometry()!==initialGeometry,'Zoom changes the actual map geometry');
    await page.getByRole('button',{name:'Reset view',exact:true}).click();
    check(await geometry()===initialGeometry,'Reset restores the original map geometry');
    check((await page.getByText('Paused sources',{exact:true}).locator('..').locator('dd').textContent()).trim()==='0','Explicit zero remains visible as zero');
    check((await page.getByText('Degraded sources',{exact:true}).locator('..').locator('dd').textContent()).trim()==='Not reported','An absent metric is not turned into zero');
    await page.getByRole('button',{name:'Inspect Live feed',exact:true}).click();
    check((await page.getByText('Posts in memory',{exact:true}).locator('..').locator('dd').textContent()).trim()==='4,000','City feed metric uses the API snapshot');
    await page.getByLabel('Agent service',{exact:true}).selectOption('pipeline');
    check(await city.locator('button[data-agent-id][data-service="api"]').count()===0,'Service filter removes the other process from the directory');
    await page.getByLabel('Search agents',{exact:true}).fill('reddit');
    check(await city.locator('button[data-agent-id]').count()===1&&await city.locator('button[data-agent-id="reddit"]').isVisible(),'Search filters actual registry entries');
    await page.getByLabel('Search agents',{exact:true}).fill('not-a-registered-agent');
    await page.getByText('No agents match these filters.',{exact:true}).waitFor();
    check(await city.locator('button[data-agent-id]').count()===0,'Unknown searches do not fabricate agent avatars');
    await page.getByLabel('Search agents',{exact:true}).fill('');
    await page.getByLabel('Agent service',{exact:true}).selectOption('all');

    const apiGuard=city.locator('button[data-agent-id="stability"][data-service="api"]').first();
    await apiGuard.focus();
    await page.keyboard.press('Enter');
    await verifyMobileInspector();
    await page.getByLabel('Message this agent',{exact:true}).fill('What is your current status?');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByText('API diagnostic reply: AI is unavailable.',{exact:false}).waitFor();
    check(fixture.chatRequests.at(-1).role==='api'&&fixture.chatRequests.at(-1).id==='stability','Keyboard-selected API agent chats with API');
    await chooseAgent('stability','pipeline');
    if (width<760) await page.screenshot({path:path.join(root,`.cache/audit-ui/office-city-inspector-${width}.png`),fullPage:false});
    await page.getByLabel('Message this agent',{exact:true}).fill('What is your current status?');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByText('PIPELINE diagnostic reply: AI is unavailable.',{exact:false}).waitFor();
    check(fixture.chatRequests.at(-1).role==='pipeline'&&fixture.chatRequests.at(-1).id==='stability','Same agent ID in pipeline routes to pipeline');
    check(Array.isArray(fixture.chatRequests.at(-1).body.history)&&fixture.chatRequests.at(-1).body.history.length===0,'The first chat with the pipeline instance cannot inherit API conversation history');
    check(await page.evaluate(()=>window.cityXss)===undefined,'Agent output is escaped, never executed');
    check(await city.locator('img[src="x"]').count()===0,'Agent output cannot create HTML elements');
    await page.getByRole('button',{name:'Clear conversation',exact:true}).click();
    check(await page.getByText('PIPELINE diagnostic reply: AI is unavailable.',{exact:false}).count()===0,'Clear conversation removes the selected history');

    if (width===1440) {
      console.log('Checking Live City chat failures, cancellation, and telemetry outages at 1440px');
      fixture.chatMode='unknown';
      await page.getByLabel('Message this agent',{exact:true}).fill('What is your current status?');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Agent chat is unavailable on this service version.'}).waitFor();
      fixture.chatMode='failed';
      await page.getByLabel('Message this agent',{exact:true}).fill('What is your current status?');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'The agent service is unavailable.'}).waitFor();
      fixture.chatMode='slow';
      await page.getByLabel('Message this agent',{exact:true}).fill('Check the current backlog.');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await eventually(()=>fixture.held.length===1,'Delayed chat must reach the selected service');
      await chooseAgent('web_optimizer','api');
      await eventually(()=>aborted.length>0,'Changing the selected agent must abort the pending chat');
      await fixture.held.shift()();
      check(await page.getByText('Late reply from the previous agent',{exact:true}).count()===0,'Aborted replies never appear in another conversation');
      fixture.chatMode='answer';
      await page.getByLabel('Message this agent',{exact:true}).fill('What is your current status?');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByText('API diagnostic reply: AI is unavailable.',{exact:false}).waitFor();
      check(fixture.chatRequests.at(-1).id==='web_optimizer','Chat recovers after a failed or cancelled request');

      fixture.holdStatus=true;
      await page.clock.setFixedTime(new Date(Date.now()+31000));
      await eventually(async()=>await motion.getAttribute('data-motion')==='idle','A 30-second-old snapshot must stop all motion');
      check(await city.locator('.lc-road-flow').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).animationName==='none'||getComputedStyle(element).animationPlayState==='paused')),'Stale telemetry stops actual road animation');
      fixture.holdStatus=false;
      for (const release of fixture.heldStatus.splice(0)) await release();
      await eventually(async()=>await motion.getAttribute('data-motion')==='active','Fresh polling restores measured activity',12000);
      fixture.apiFailure=true;
      fixture.pipelineFailure=true;
      await eventually(async()=>await motion.getAttribute('data-motion')==='idle','Unavailable services stop motion',12000);
      await page.getByRole('button',{name:'Inspect Staging depot',exact:true}).click();
      const waiting=page.getByText('Waiting for promotion',{exact:true});
      await waiting.waitFor();
      check((await waiting.locator('..').locator('dd').textContent()).trim()==='Not reported','Offline staging count is unavailable, not an invented zero');
      fixture.apiFailure=false;
      fixture.pipelineFailure=false;
      fixture.missing=true;
      fixture.wrongPipelineRole=true;
      const [wrongRoleResponse]=await Promise.all([
        page.waitForResponse(response=>response.url()===PIPELINE+'/office/status'&&response.status()===200),
        page.waitForResponse(response=>response.url()===API+'/office/status'&&response.status()===200),
      ]);
      check((await wrongRoleResponse.json()).server.serviceRole==='api','Wrong-role fixture returned API data from the pipeline origin');
      await eventually(async()=>await city.locator('.lc-observation[data-service="pipeline"]').getAttribute('data-freshness')==='unavailable','API data from pipeline origin must stay unavailable');
      check((await waiting.locator('..').locator('dd').textContent()).trim()==='Not reported','Missing metrics remain explicitly unreported after a successful request');
      fixture.missing=false;
      fixture.wrongPipelineRole=false;
      await eventually(async()=>await motion.getAttribute('data-motion')==='active','City recovers when complete telemetry returns',12000);
      await eventually(async()=>(await waiting.locator('..').locator('dd').textContent()).trim()==='37','Recovery restores the real staging count');
      check((await waiting.locator('..').locator('dd').textContent()).trim()==='37','Recovery restores the real staging count');
    }

    await page.emulateMedia({reducedMotion:'reduce'});
    await eventually(async()=>await motion.getAttribute('data-motion')==='reduced','System reduced motion must disable city animation');
    check(await city.locator('.lc-road-flow').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).animationName==='none'||getComputedStyle(element).animationPlayState==='paused')),'Reduced motion stops actual animations');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await eventually(async()=>await motion.getAttribute('data-motion')==='active','Motion can recover when reduced motion is removed');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`City has no page overflow at ${width}px`);
    await page.getByRole('heading',{name:/^Live City/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,`.cache/audit-ui/office-city-${width}.png`),fullPage:false});
    check(await page.evaluate(token=>![localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>String(storage.getItem(key)).includes(token))),TOKEN),'Office credentials are never persisted');
    check(await page.evaluate(()=>![localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>/current status|diagnostic reply|previous agent/.test(String(storage.getItem(key)))))),'Office conversations stay out of persistent browser storage');
    check(await page.evaluate(()=>localStorage.getItem('ufi_office_token')===null&&sessionStorage.getItem('ufi_office_token')===null),'Legacy credentials are removed from both stores');
    check(fixture.requests.filter(request=>request.method!=='GET').every(request=>request.path.endsWith('/chat')),'City interactions never trigger operational commands');
    await page.getByRole('button',{name:'Open Post Pipeline',exact:true}).first().click();
    await page.getByRole('heading',{name:'Post Pipeline',exact:true}).waitFor();
    check(new URL(page.url()).hash==='#post-pipeline','City links open the real post pipeline view');
    check(errors.length===0,`No Office runtime errors: ${errors.join('; ')}`);
    console.log(`PASS: Live City service routing, chat, motion, keyboard and layout at ${width}px`);
  } finally {
    for (const release of [...fixture.held,...fixture.heldStatus]) await release();
    await context.close();
  }
}

let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for (const width of [1440,768,390,320]) await auditWidth(browser,width);
  console.log(`Office Live City audit: ${checks} checks passed with two separate intercepted service origins.`);
} finally { await browser?.close(); await server.close(); }
