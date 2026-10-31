import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server = await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,define:{'import.meta.env.VITE_API_URL':JSON.stringify(''),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify('/pipeline')},server:{host:'127.0.0.1',port:5223,strictPort:false}});
const now = new Date().toISOString(), userId = 'a0000000-0000-4000-8000-000000000001', deviceId = 'd0000000-0000-4000-8000-000000000001';
const user = {id:userId,name:'Review Member',email:'review@example.com',onboarded:true,createdAt:now};
const item = {id:'review-item',postId:'post-spam',title:'Spam review example',content:'Retained text for inspection',source:'news',sourceUrl:'javascript:alert(1)',status:'rejected',reason:'link_spam',explanation:'Too many external links.',at:now};
const policy = {enabled:true,maxPerSourcePerMinute:300,maxPerAuthorPerMinute:25,duplicateWindowSeconds:300,targetApprovalPct:85,minimumSample:30,cooldownSeconds:60,blockedSources:[]};
let browser;
try {
  await server.listen(); await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
  browser = await chromium.launch({channel:process.platform === 'win32' ? 'msedge' : undefined});
  for(const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}}), page = await context.newPage(), errors = [], writes = [];
    let blocked = false, failDetail = false;
    page.on('pageerror',error => errors.push(error.message));
    await page.route(url => /^\/(pipeline\/)?office\//.test(url.pathname),async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.replace(/^\/pipeline/,'');
      assert.equal(url.searchParams.has('token'),false);
      if(req.headers()['x-office-token'] !== 'audit-only') return route.fulfill({status:401,json:{message:'Unauthorized'}});
      if(req.method() === 'POST') writes.push({path:url.pathname,body:req.postDataJSON()});
      if(endpoint === '/office/security/devices') return route.fulfill({json:{threshold:5,blockOn:6,scope:'Registered device identity.',devices:[{id:deviceId,strikes:6,blockedAt:now,createdAt:now,accounts:1,events:[{reason:'link_spam',activity:'/groups/test/posts',occurred_at:now}]}]}});
      if(endpoint.endsWith('/unblock')) return route.fulfill({json:{ok:true,message:'Device unblocked and strike count reset.'}});
      if(endpoint === '/office/feed-audit/items/review-item') return route.fulfill(failDetail ? {status:503,json:{message:'Audit detail unavailable'}} : {json:{item}});
      if(endpoint === '/office/feed-audit') return route.fulfill({json:{items:url.searchParams.get('q') === 'nothing' ? [] : [item],hasMore:false,summary:{checked:100,approved:85,rejected:15,held:12,approvalPct:85},policy:{...policy,blockedSources:blocked ? [{source:'news',reason:'Breach review',blockedAt:now}] : []},reasons:[{id:'link_spam',label:'Link spam'}],sources:[{id:'news',label:'News'}],commands:[{id:'feed.audit-review',label:'Review current feed',description:'Screen live content.'},{id:'feed.audit-protect',label:'Protect feed',description:'Enable controls and review.'}]}});
      if(endpoint.startsWith('/office/controls/')) { if(endpoint.includes('source.block.news')) blocked = true; return route.fulfill({json:{result:{ok:true,checked:100}}}); }
      if(endpoint === '/office/topic-transfer') return route.fulfill({json:{available:true,generatedAt:now,topics:[{topic:'Engineering',live:20,staged:10,subtopics:[{name:'Software',live:15,staged:5}]}],unknown:{live:4,staged:2},taxonomy:[{topic:'Engineering',subtopics:['Software']}]}});
      if(endpoint === '/office/topic-transfer/transfer') return route.fulfill({json:{ok:true,transferred:5,pendingAfter:5}});
      if(endpoint.endsWith('/optimize-unknown')) return route.fulfill({json:{ok:true,checked:6,updated:4,remaining:2}});
      if(endpoint.endsWith('/usage')) return route.fulfill({json:{available:true,user,days:30,activity:{posts:3,comments:2,sourceActions:4,savedPosts:1,deliveredPosts:40,engagedPosts:6,lastRecordedAt:now,daily:[]},generation:{period:{resetsAt:now},limits:{image:{used:1,limit:10,remaining:9}}},affinity:[],recommendations:['Refresh the delivery cache when content appears stale.'],commands:[{id:'refresh-feed',label:'Refresh user feed',description:'Clear temporary delivery caches.'},{id:'balance-interests',label:'Balance interests',description:'Reduce extreme weights.'}]}});
      if(endpoint.endsWith('/optimize')) return route.fulfill({json:{ok:true,command:req.postDataJSON().command}});
      if(endpoint === '/office/users') return route.fulfill({json:{available:true,recent:[user],total:1,onboarded:1,incomplete:0,today:1,last7:1,last30:1,sinceMay:1,incompleteSinceMay:0,pagination:{total:1,pages:1},generatedAt:now,email:{available:false},signupRequests:{available:false}}});
      if(endpoint.endsWith('/status')) return route.fulfill({json:{server:{uptime:120,db:'connected'}}});
      if(endpoint.endsWith('/stream')) return route.fulfill({contentType:'text/event-stream',body:'data: {"backlog":[]}\n\n'});
      return route.fulfill({json:{agents:{}}});
    });
    await page.goto(server.resolvedUrls.local[0]+'#feed-audit',{waitUntil:'domcontentloaded'});
    await page.getByLabel('Access token',{exact:true}).fill('audit-only'); await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
    await page.getByRole('button',{name:item.title,exact:true}).click();
    const details = page.getByRole('region',{name:'Audit item details'});
    await details.getByText(item.content,{exact:true}).waitFor();
    assert.equal(await details.getByRole('link',{name:'Open original source'}).count(),0,'Unsafe source URLs are not links');
    await page.getByLabel('Source to block',{exact:true}).selectOption('news'); await page.getByLabel('Reason',{exact:true}).fill('Breach review');
    await page.getByRole('button',{name:'Block source',exact:true}).click(); await page.getByRole('button',{name:'Unblock news'}).waitFor();
    assert.equal(writes.filter(x => x.path.includes('source.block.news')).length,1);
    await page.getByRole('button',{name:'Run protection bundle',exact:true}).click(); await page.getByText('Command results: feed.audit-protect',{exact:false}).waitFor();
    assert.equal(writes.filter(x => x.path.includes('feed.audit-protect')).length,2,'Bundle runs once on each owning service');
    await page.getByText(/d0000000 · 6 violations/).click(); await page.getByRole('button',{name:'Review and unblock device',exact:true}).click();
    await page.getByLabel('Review reason',{exact:true}).fill('Reviewed false positive'); await page.getByRole('button',{name:'Unblock and reset strikes',exact:true}).click();
    await page.getByText('Device unblocked and strike count reset.',{exact:true}).waitFor();
    assert.equal(writes.find(x => x.path.endsWith('/unblock')).body.reason,'Reviewed false positive');
    await page.getByLabel('Search audit',{exact:true}).fill('nothing'); await page.getByText('No audit records match these filters.',{exact:true}).waitFor();
    await page.getByLabel('Search audit',{exact:true}).fill(''); failDetail = true; await page.getByRole('button',{name:item.title,exact:true}).click();
    await page.getByText('Audit detail unavailable',{exact:true}).waitFor(); assert.equal(await page.getByText(item.content,{exact:true}).count(),0);
    await page.screenshot({path:path.join(root,`.cache/audit-ui/office-feed-audit-${width}.png`)});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`Feed audit fits ${width}px`);
    await page.getByRole('button',{name:'Topic Transfer',exact:true}).click(); await page.getByLabel('Transfer topic',{exact:true}).selectOption('Engineering'); await page.getByLabel('Transfer subtopic',{exact:true}).selectOption('Software');
    await page.getByRole('button',{name:'Transfer selected topic',exact:true}).click(); await page.getByText('Topic transfer result',{exact:true}).waitFor();
    assert.deepEqual(writes.find(x => x.path.endsWith('/topic-transfer/transfer')).body,{confirmed:true,topic:'Engineering',subtopic:'Software',maxBatches:1});
    await page.getByRole('button',{name:'Optimize unknown topics',exact:true}).click(); await page.getByText('Unknown optimization result',{exact:true}).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`Topic transfer fits ${width}px`);
    await page.getByRole('button',{name:'Users',exact:true}).click(); await page.getByRole('button',{name:'View usage for Review Member',exact:true}).click();
    await page.getByRole('button',{name:'Refresh user feed',exact:true}).click(); await page.getByText('Usage command completed.',{exact:false}).waitFor();
    assert.deepEqual(writes.find(x => x.path.endsWith('/optimize')).body,{command:'refresh-feed',confirmed:true});
    await page.screenshot({path:path.join(root,`.cache/audit-ui/office-user-usage-${width}.png`)});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`User usage fits ${width}px`);
    assert.deepEqual(errors,[]); await context.close(); console.log(`Office operations ${width}px: audit details, safe links, source blocks, bundle, device review, topic transfer, user commands passed`);
  }
} finally { await browser?.close(); await server.close(); }
