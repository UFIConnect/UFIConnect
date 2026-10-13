import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {installAuditMember,auditNavigate} from './audit-session.mjs';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const app=await createAppHarness();app.seedUser(member('scroll-review',{joinedGroups:['review-group']}));
const server=await createServer({root:path.join(root,'web'),envDir:false,cacheDir:path.join(root,'.cache/vite-scroll-review'),
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_API_FALLBACK_URL':JSON.stringify('')},
  server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:app.base,rewrite:value=>value.replace(/^\/api/,'')}}}});
const posts=Array.from({length:40},(_,i)=>({id:'scroll-post-'+i,source:'github',title:'Scroll fixture '+i,
  content:'A public update for the continuous feed. '.repeat(8),isExternal:true,sourceUrl:'https://github.com/uficonnect/review/issues/'+i,
  author:{id:'creator-'+i,name:'Fixture creator '+i,profileUrl:'https://github.com/fixture'},createdAt:new Date(Date.now()-i*60000).toISOString()}));
const native=posts.map(post=>({...post,source:'uficonnect',isExternal:false,sourceUrl:null,author:{id:'fixture-member',name:'Fixture member'}}));
let browser;
try{
  await server.listen();const base=server.resolvedUrls.local[0];
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
    let failNext=false,feedReads=0,guest=false;
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      const endpoint=url.pathname.replace(/^\/api/,'');
      if(!url.pathname.startsWith('/api/'))return route.continue();
      if(guest&&endpoint==='/auth/session')return route.fulfill({status:401,json:{error:'Guest fixture'}});
      if(endpoint==='/feed/location')return route.fulfill({json:{automaticLocationAvailable:true,countryCode:'US',countryName:'United States',city:'Seattle'}});
      if(endpoint==='/snaps')return route.fulfill({json:{snaps:[],sourceErrors:{}}});
      if(endpoint==='/office/feed'||endpoint==='/feed'||endpoint==='/feed/guest'){
        const more=!!url.searchParams.get('cursor')||Number(url.searchParams.get('page'))>1;
        if(more)feedReads++;
        if(more&&failNext){failNext=false;return route.fulfill({status:500,json:{error:'Synthetic load failure'}});}
        const mode=url.searchParams.get('mode');
        const batch=more?posts.slice(29):posts.slice(0,30);
        const selected=mode==='groups'?batch.map(post=>({...post,source:'uficonnect',isExternal:false,groupId:'review-group',group:{id:'review-group',name:'Review group'}})):batch;
        return route.fulfill({json:{mode,posts:selected,hasMore:!more,cursor:more?'':'second-batch',nativeUficonnectIncluded:true}});
      }
      if(endpoint==='/posts'){
        const offset=Number(url.searchParams.get('offset'))||0;
        return route.fulfill({json:{posts:native.slice(offset,offset+12),hasMore:offset+12<native.length,total:native.length}});
      }
      if(endpoint==='/command-center/your-content/feed'){
        const offset=(Number(url.searchParams.get('page')||1)-1)*12;
        return route.fulfill({json:{posts:posts.slice(offset,offset+12),hasMore:offset+12<posts.length,totalAvailable:posts.length}});
      }
      if(endpoint==='/opportunities')return route.fulfill({json:{opportunities:[],hasMore:false,totalCount:0}});
      if(/events|stream/.test(endpoint))return route.abort();
      return route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await installAuditMember(page,app,'scroll-review');
    await auditNavigate(page,base+'?feed=feed');
    for(const mode of ['feed','following','groups']){
      console.log('CHECK '+width+' '+mode);
      failNext=mode==='feed';
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.goto(base+'?feed='+mode,{waitUntil:'domcontentloaded'});
      const cards=page.locator('.feed-continuous-results > [data-feed-position]');await cards.first().waitFor();
      assert.ok(await cards.count()>=30);assert.equal(await page.getByRole('navigation',{name:'Feed pages',exact:true}).count(),0);
      await cards.last().evaluate(element=>element.scrollIntoView({block:'end'}));
      if(mode==='feed'){
        const retry=page.getByRole('button',{name:'Try again',exact:true});await retry.waitFor();
        assert.equal(await cards.count(),30,'A failed load retains earlier posts');await retry.click();
      }
      try { await page.waitForFunction(()=>document.querySelectorAll('.feed-continuous-results > [data-feed-position]').length===40); }
      catch(error) { console.log(JSON.stringify({mode,count:await cards.count(),status:await page.locator('.feed-continuous-results').getAttribute('data-feed-has-more'),sentinel:await page.locator('[data-feed-scroll-sentinel]').count(),alerts:await page.getByRole('alert').allTextContents(),url:page.url()}));throw error; }
      assert.equal(await cards.filter({hasText:'Scroll fixture 0'}).count(),1,'Earlier posts stay mounted and duplicates are removed');
      await page.waitForFunction(()=>document.querySelector('.feed-continuous-results')?.dataset.feedHasMore==='false');
      const completed=feedReads;await page.waitForTimeout(200);assert.equal(feedReads,completed,'An exhausted cursor stops loading');
    }
    await page.goto(base+'?feed=ufi',{waitUntil:'domcontentloaded'});
    const ufiCards=page.locator('#ufi-community-posts .post-card');await ufiCards.first().waitFor();
    assert.ok(await ufiCards.count()>=12);assert.equal(await page.getByRole('navigation',{name:'Community post pages'}).count(),0);
    await page.evaluate(()=>document.querySelector('[data-feed-scroll-sentinel]')?.scrollIntoView({block:'end'}));
    await page.waitForFunction(()=>document.querySelectorAll('#ufi-community-posts .post-card').length>=24);
    await page.goto(base+'you',{waitUntil:'domcontentloaded'});await page.locator('.post-card').first().waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Your connected posts pages'}).count(),0);
    await page.evaluate(()=>document.querySelector('[data-feed-scroll-sentinel]')?.scrollIntoView({block:'end'}));await page.waitForFunction(()=>document.querySelectorAll('.post-card').length>=24);
    await page.goto(base+'?feed=feed',{waitUntil:'domcontentloaded'});await page.locator('.feed-continuous-results').waitFor();
    if(width<600){await page.getByRole('button',{name:'Open account menu',exact:true}).click();}
    const account=page.locator(width<600?'#mobile-account-drawer':'.sidebar-nav');
    const post=account.getByRole('link',{name:'Post to a group',exact:true}),create=account.getByRole('link',{name:'Create a group',exact:true});
    assert.ok(await post.evaluate((element,href)=>element.nextElementSibling?.getAttribute('href')===href,await create.getAttribute('href')),'Post to a group precedes Create a group');
    if(width<600){await page.getByRole('button',{name:'Close account sidebar'}).click();await page.locator('button[aria-controls="mobile-feed-drawer"]').click();}
    const tools=page.locator(width<600?'#mobile-feed-drawer .mobile-feed-drawer-bottom':'.home-feed-rail-bottom');
    const messages=tools.getByRole('button',{name:'Messages',exact:true});await messages.scrollIntoViewIfNeeded();
    assert.ok(await messages.evaluate(element=>element.nextElementSibling?.textContent.includes('Discover groups')),'Messages precedes Discover groups');
    await messages.click();await page.getByRole('dialog',{name:'Messages',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close messages',exact:true}).click();
    if(width<600)await page.locator('button[aria-controls="mobile-feed-drawer"]').waitFor();
    guest=true;await page.route('**/auth/session',route=>route.fulfill({status:401,json:{error:'Guest fixture'}}));
    await page.goto(base+'global',{waitUntil:'domcontentloaded'});await page.locator('.guest-feed-main .post-card').first().waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Public feed pages'}).count(),0);
    await page.evaluate(()=>document.querySelector('[data-feed-scroll-sentinel]')?.scrollIntoView({block:'end'}));
    await page.waitForFunction(()=>document.querySelectorAll('.guest-feed-main .post-card').length===40);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS continuous member/UFI/connected/guest feeds, retry, deduplication, exhaustion and navigation at '+width);
  }
}finally{await browser?.close();await server.close();await app.close();}
