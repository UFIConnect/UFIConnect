import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import sourcePullLimits from '../backend/source-pull-limits.js';
import { fulfillOfficeWelcomeRead, returnFromOfficeWelcome } from './office-welcome-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,
  cacheDir:path.join(root,'.cache/vite-office-source-rates'),
  define:{'import.meta.env.VITE_API_URL':JSON.stringify(''),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify('/pipeline')},
  server:{host:'127.0.0.1',port:5234,strictPort:false}});
const workers = Object.entries(sourcePullLimits.DEFAULT_SOURCE_PULL_LIMITS).map(([id,limit],index) => ({
  id,name:`${id} Agent`,executionRole:'pipeline',status:'healthy',triggerable:false,
  interval:'obsolete cadence',cadence:'obsolete cadence',
  pullLimit:{...limit,minSpacingMs:Math.ceil(limit.windowSeconds*1000/limit.maxPulls)},
  pullLimitLabel:`${limit.maxPulls} ${limit.maxPulls === 1 ? 'pull' : 'pulls'} / ${limit.windowSeconds}s`,
  // Deliberately independent from the policy minimum spacing.
  collectionIntervalMs:(index+40)*1000,cycleMinutes:index+10,postCount:10,fetchCount:3,
  health:{status:'healthy',fetchCount:3,totalErrors:0,lastSuccess:new Date().toISOString()},logs:[],
}));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.platform === 'win32' ? 'msedge' : undefined});
  for (const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route(url=>/^\/(pipeline\/)?office\//.test(url.pathname),async route=>{
      const url=new URL(route.request().url()), role=url.pathname.startsWith('/pipeline')?'pipeline':'api';
      const endpoint=url.pathname.replace(/^\/pipeline/,'');
      if (route.request().headers()['x-office-token'] !== 'audit-only') return route.fulfill({status:401,json:{message:'Unauthorized'}});
      if(await fulfillOfficeWelcomeRead(route,endpoint)) return;
      if(endpoint==='/office/controls') return route.fulfill({json:{controls:[],history:[]}});
      if(endpoint==='/office/status') return route.fulfill({json:{server:{serviceRole:role,uptime:120,db:'connected'},sources:{total:workers.length,healthy:workers.length,workers}}});
      if(endpoint==='/office/agents') return route.fulfill({json:{agents:role==='pipeline'?Object.fromEntries(workers.map(worker=>[worker.id,worker])):{}}});
      if(endpoint.endsWith('/stream')) return route.fulfill({contentType:'text/event-stream',body:'data: {"backlog":[]}\n\n'});
      return route.fulfill({json:{}});
    });
    await page.goto(server.resolvedUrls.local[0]+'#agents',{waitUntil:'domcontentloaded'});
    await page.getByLabel('Access token',{exact:true}).fill('audit-only');
    await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
    await returnFromOfficeWelcome(page,'Agents');
    await page.getByRole('heading',{name:'Agent Control',exact:true}).waitFor();
    await page.getByText(`${workers.at(-1).id} Agent`,{exact:true}).waitFor();
    for (const worker of workers) {
      const card=page.getByText(worker.name,{exact:true}).locator('xpath=../../..');
      assert.ok((await card.innerText()).includes(`Pull limit: ${worker.pullLimitLabel}`),`${worker.id} agent shows current policy`);
      assert.ok((await card.innerText()).includes(`Collection interval: ${worker.collectionIntervalMs/1000}s`),`${worker.id} agent shows its independent scheduler interval`);
    }
    await page.getByRole('button',{name:'Live Sources',exact:true}).click();
    await page.getByRole('heading',{name:'Live Sources',exact:true}).waitFor();
    await page.getByText(workers.at(-1).id,{exact:true}).first().waitFor();
    const sourceText=await page.locator('main').innerText();
    for(const worker of workers) {
      assert.ok(sourceText.includes(`Pull limit: ${worker.pullLimitLabel} · Collection interval: ${worker.collectionIntervalMs/1000}s`),`${worker.id} source shows policy and actual interval`);
    }
    assert.ok(!sourceText.includes('obsolete cadence'),'Legacy cadence is never displayed as the current source rate');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Source cards fit ${width}px`);
    await page.getByRole('button',{name:'Live City',exact:true}).click();
    const city=page.getByTestId('live-city');
    await city.waitFor();
    await page.getByRole('button',{name:'Street map',exact:true}).click();
    for(const id of ['bluesky','medium','openalex','crossref','datacite','zenodo']) {
      const worker=workers.find(row=>row.id===id);
      await city.locator(`button[data-agent-id="${id}"][data-service="pipeline"]`).first().click();
      const inspector=city.locator('.lc-inspector');
      await inspector.getByRole('heading',{name:worker.name,exact:true}).waitFor();
      assert.equal(await inspector.locator('dt',{hasText:/^Pull limit$/}).locator('..').locator('dd').innerText(),worker.pullLimitLabel,`${id} city inspector uses current limit`);
      assert.equal(await inspector.locator('dt',{hasText:/^Collection interval$/}).locator('..').locator('dd').innerText(),`${worker.collectionIntervalMs/1000}s`,`${id} city inspector keeps collection interval separate`);
    }
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`Office source rates ${width}px: ${workers.length} agents and source cards, Bluesky/Medium/research inspectors passed`);
  }
} finally { await browser?.close(); await server.close(); }
