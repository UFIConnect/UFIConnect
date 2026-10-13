// Real Feed card, member PostList and post detail with a complete source fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.cache/app-update-20261013/full-post-text-qa');
const url='https://example.com/complete-source?topic=community';
const paragraphs=Array.from({length:36},(_,i)=>`Paragraph ${i+1}: Café conversations bring people together — 日本語のコミュニティ 🌍. Every supplied sentence should remain available when the reader expands this post.`);
const expected=paragraphs.join('\n\n')+'\n\n'+'LongWord'.repeat(60)+'\n\nFINAL SOURCE SENTINEL: the last paragraph is here.';
const content=expected+'\n\n'+url;
const post={id:'full-source-text',title:'Complete community update',content,source:'uficonnect',createdAt:'2026-10-13T12:00:00Z',author:{id:'source-author',name:'Source author'},authorId:'source-author',likesCount:0,commentsCount:0};
const fixture=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {PostCard} from '/src/pages/Feed.jsx';
import PostList from '/src/components/PostList.jsx';
import PostDetail from '/src/pages/PostDetail.jsx';
import '/src/index.css';
const post=${JSON.stringify(post)};
function Cards(){return React.createElement('main',{style:{width:'calc(100% - 32px)',maxWidth:720,margin:'0 auto'}},
React.createElement('section',{'aria-label':'Feed fixture'},React.createElement(PostCard,{post})),
React.createElement('section',{'aria-label':'PostList fixture'},React.createElement(PostList,{posts:[post],interactive:false})),
React.createElement(Link,{to:'/p/'+post.id},'Open full post'));}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider,null,React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,React.createElement(SavedItemsProvider,null,React.createElement(ToastProvider,null,
React.createElement(Routes,null,React.createElement(Route,{path:'/',element:React.createElement(Cards)}),React.createElement(Route,{path:'/p/:id',element:React.createElement(PostDetail)}))))))));`;
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,cacheDir:path.join(root,'.cache/audit-vite-full-post'),
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_API_FALLBACK_URL':JSON.stringify('/api'),'import.meta.env.VITE_AUTH0_DOMAIN':JSON.stringify(''),'import.meta.env.VITE_AUTH0_CLIENT_ID':JSON.stringify('')},
  plugins:[{name:'full-post-fixture',resolveId(id){if(id==='virtual:full-post-audit.jsx')return '\0virtual:full-post-audit.jsx';},load(id){if(id==='\0virtual:full-post-audit.jsx')return fixture;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(!['/','/p/full-source-text'].includes(new URL(req.url,'http://fixture.invalid').pathname))return next();
    res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:full-post-audit.jsx"></script></body></html>'));
  });}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const report={checkedAt:new Date().toISOString(),fixturesOnly:true,suppliedCharacters:content.length,checks:0,results:[]};
const check=(value,message)=>{assert.ok(value,message);report.checks++;};
let browser;
try{
  await fs.mkdir(output,{recursive:true});await server.listen();const origin=new URL(server.resolvedUrls.local[0]).origin;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  for(const width of [320,390,820,1440]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();
    const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>{
      const request=route.request(),address=new URL(request.url());
      if(address.origin!==origin)return route.abort();
      if(!address.pathname.startsWith('/api/'))return route.continue();
      const endpoint=address.pathname.slice(4);
      if(endpoint==='/auth/session')return route.fulfill({status:401,json:{}});
      if(endpoint==='/feed/full-source-text')return route.fulfill({json:{post}});
      if(endpoint==='/posts/engaged')return route.fulfill({json:{ok:true}});
      if(!['GET','HEAD'].includes(request.method()))writes.push(endpoint);
      if(/events|stream/.test(endpoint))return route.abort();
      return route.fulfill({json:{posts:[],postIds:[],comments:[],notifications:[],items:[],sources:{},hasMore:false}});
    });
    try{
      await page.goto(origin);
      for(const name of ['Feed fixture','PostList fixture']){
        const region=page.getByRole('region',{name,exact:true});const more=region.getByRole('button',{name:'Read more',exact:true});await more.waitFor();
        check(!(await region.innerText()).includes('FINAL SOURCE SENTINEL'),`${name}: initial card remains an excerpt`);
        await more.click();const less=region.getByRole('button',{name:'Show less',exact:true});await less.waitFor();
        const paragraph=less.locator('xpath=..');
        const text=await paragraph.evaluate(element=>{const copy=element.cloneNode(true);copy.querySelectorAll('button').forEach(button=>button.remove());return copy.textContent.trim();});
        check(text===expected,`${name}: every supplied Unicode paragraph and final sentinel survives expansion`);
        check(text.length>5000,`${name}: expanded body exceeds the former import limit`);
        check(await paragraph.evaluate(element=>getComputedStyle(element).whiteSpace==='pre-wrap'),`${name}: supplied paragraph breaks remain rendered`);
        check(await paragraph.evaluate(element=>element.scrollHeight<=element.clientHeight+1),`${name}: expanded text is not clipped by a fixed height`);
        check(await region.getByRole('region',{name:'Links in this post',exact:true}).getByRole('link').getAttribute('href')===url,`${name}: separate link preview keeps the full destination`);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${name}: long text wraps within narrow viewports`);
        await less.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${name.startsWith('Feed')?'feed':'list'}-expanded-${width}.png`)});
        await less.click();await more.waitFor();check(!(await region.innerText()).includes('FINAL SOURCE SENTINEL'),`${name}: collapse is reversible`);
      }
      await page.getByRole('link',{name:'Open full post',exact:true}).click();await page.getByRole('heading',{name:post.title,exact:true}).waitFor();
      const detail=page.locator('.post-card'),paragraph=detail.locator(':scope > p').first();
      check((await paragraph.textContent()).trim()===expected,'Full detail route displays all supplied body text without expansion');
      check(await detail.getByRole('button',{name:'Read more',exact:true}).count()===0,'Detail does not re-truncate long supplied writing');
      check(await detail.getByRole('region',{name:'Links in this post',exact:true}).getByRole('link').getAttribute('href')===url,'Detail preserves the original link destination');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Full detail fits the viewport');
      await paragraph.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`detail-${width}.png`)});
      check(errors.length===0,'No component rendering errors');check(writes.length===0,`Read-only browsing makes no account writes: ${writes.join(', ')}`);
      report.results.push({width,passed:true});
    }catch(error){await page.screenshot({path:path.join(output,`failure-${width}.png`)});throw error;}
    finally{await context.close();}
  }
  report.passed=true;console.log(`PASS: complete supplied post text in Feed/PostList/Detail, ${report.checks} checks at 320/390/820/1440`);
}catch(error){report.passed=false;report.error=error.message;throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
