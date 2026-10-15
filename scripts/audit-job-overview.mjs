// Real job cards/dialogs, synthetic source listings, no external account calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/app-update-20261013/job-overview-qa');
const overview = 'This role connects patients with a regional care team throughout their recovery. You will join a service that works closely with families.';
const fullDescription = '<h2>About our company</h2><p>' + 'The employer has a long history of regional services. '.repeat(550) + '</p><h2>Responsibilities</h2><ul><li>Schedule patient visits</li><li>Answer calls</li><li>Maintain records</li><li>Review care plans</li><li>Coordinate teams</li><li>Document service changes</li></ul><h2>Requirements</h2><p>Relevant experience with patient services.</p><h2>Benefits</h2><p>Paid leave according to the original listing.</p><h2>Additional information</h2><p>FINAL SUPPLIED PARAGRAPH: flexible interview arrangements.</p><script>window.untrustedJob = true</script>';
const fixtures = [
  { key: 'overview', post: { id:'job-overview', title:'Care coordinator', org:'Example Health', source:'remotive', sourceUrl:'https://example.com/jobs/care', summary:overview, fullDescription, description:'A separate supplied paragraph about the regional service.' } },
  { key: 'only-duties', post: { id:'job-duties',title:'Engineer',source:'muse',sourceUrl:'https://example.com/jobs/engineer',content:'Responsibilities\n- Write code\n- Test APIs\nRequirements\n- JavaScript' } },
  { key: 'missing', post: { id:'job-missing',title:'Analyst',source:'indeed',sourceUrl:'https://example.com/jobs/analyst' } },
  { key: 'compact', compact:true, post: { id:'job-compact',title:'Program specialist',source:'usajobs',summary:'This position supports a public program serving local residents.',content:'Responsibilities\n- Review reports\n- Maintain records',sourceUrl:'https://www.usajobs.gov/job/123456789' } },
];
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import JobPostContent from '/src/components/JobPostContent.jsx';
import {JobDetail} from '/src/pages/Opportunities.jsx';
import '/src/index.css';
const cases=${JSON.stringify(fixtures)};
const detail={...cases[0].post,source:'We Work Remotely — International opportunities',tags:[]};
const body=React.createElement('main',{style:{maxWidth:720,margin:'0 auto',padding:16}},cases.map(({key,post,compact})=>React.createElement('article',{'aria-label':key,key,style:{marginBottom:24}},React.createElement('h2',null,post.title),React.createElement(JobPostContent,{post,compact}))),React.createElement('section',{'aria-label':'Job detail actions'},React.createElement(JobDetail,{job:detail})));
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,React.createElement(SavedItemsProvider,null,React.createElement(ToastProvider,null,body)))));`;
const server = await createServer({ root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
  cacheDir:path.join(root,'.cache/audit-vite-job-overview'),
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_API_FALLBACK_URL':JSON.stringify('/api'),'import.meta.env.VITE_AUTH0_DOMAIN':JSON.stringify(''),'import.meta.env.VITE_AUTH0_CLIENT_ID':JSON.stringify('')},
  plugins:[{ name:'job-overview-fixture',
    resolveId(id) { if(id==='virtual:job-overview-audit.jsx') return '\0virtual:job-overview-audit.jsx'; },
    load(id) { if(id==='\0virtual:job-overview-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async(req,res,next)=>{
      if(new URL(req.url,'http://fixture.invalid').pathname!=='/') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:job-overview-audit.jsx"></script></body></html>'));
    }); },
  }],server:{host:'127.0.0.1',port:0,hmr:false,watch:null} });
const report = { checkedAt:new Date().toISOString(),fixturesOnly:true,checks:0,results:[] };
const check = (value,message)=>{assert.ok(value,message);report.checks++;};
let browser;
try {
  await fs.mkdir(output,{recursive:true}); await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  for(const width of [320,390,820,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const page = await context.newPage(), errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin&&url.pathname.startsWith('/api/'))return route.fulfill({status:url.pathname==='/api/auth/session'?401:200,json:{posts:[],jobs:[],postIds:[]}});
      if(url.origin===origin) return route.continue();
      external.push(url.href);return route.abort();
    });
    try {
      await page.goto(origin);
      const card=page.getByRole('article',{name:'overview',exact:true});
      await card.getByRole('heading',{name:'Role overview',exact:true}).waitFor();
      check(await card.locator('.job-post-summary p').innerText()===overview,'Source overview is shown instead of a responsibility list');
      check(!/Schedule patient visits|Company|long history/.test(await card.locator('.job-post-summary').innerText()),'Overview excludes duties and company boilerplate');
      check(await card.locator('.job-post-duties li').count()===5,'Card responsibilities remain a readable separate five-item excerpt');
      check((await card.locator('.job-post-duties').innerText()).includes('Schedule patient visits'),'Real supplied responsibilities remain visible');
      check(await card.getByRole('heading',{name:'Role task summary'}).count()===0,'Duplicated duty summary is removed');
      const opener=card.getByRole('button',{name:'Read the full supplied listing',exact:true});
      await opener.click();
      const dialog=page.getByRole('dialog',{name:'Care coordinator',exact:true});
      await dialog.waitFor();
      const panel=dialog.getByRole('tabpanel');
      const full=await panel.innerText();
      check(full.length>25000,'Full supplied description is not reduced to the card excerpt');
      check(full.includes(overview)&&full.includes('A separate supplied paragraph'),'Separate supplied overview and description both remain accessible');
      check(full.includes('Document service changes')&&full.includes('FINAL SUPPLIED PARAGRAPH'),'Sixth duty and final source paragraph are retained');
      check(full.includes('Relevant experience')&&full.includes('Paid leave according'),'Requirements and benefits remain available');
      check(!full.includes('untrustedJob')&&await page.evaluate(()=>window.untrustedJob)===undefined,'Source HTML scripts are removed without execution');
      check(await dialog.getByRole('link',{name:'Open the original job listing'}).getAttribute('href')==='https://example.com/jobs/care','Original source destination is preserved');
      check((await dialog.locator('footer').innerText()).includes('Remotive'),'Source attribution remains visible');
      await dialog.getByRole('tab',{name:'Responsibilities',exact:true}).click();
      check((await panel.innerText()).includes('Document service changes')&&!(await panel.innerText()).includes('Relevant experience'),'Responsibility topic contains all and only its supplied section');
      await page.keyboard.press('ArrowRight');
      check(await dialog.getByRole('tab',{name:'Requirements',exact:true}).getAttribute('aria-selected')==='true','Keyboard topic navigation remains functional');
      check(await dialog.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=window.innerWidth&&box.top>=0&&box.bottom<=window.innerHeight;}),'Full listing dialog fits the viewport');
      await page.screenshot({path:path.join(output,`listing-${width}.png`)});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      check(await opener.evaluate(element=>document.activeElement===element),'Closing full listing restores keyboard focus');
      const duties=page.getByRole('article',{name:'only-duties',exact:true});
      check((await duties.locator('.job-post-summary p').innerText()).startsWith('A role overview was not supplied.'),'Duty-only sources do not fabricate a role overview');
      check(await duties.locator('.job-post-duties li').count()===2,'Duty-only listing still displays its actual tasks');
      const missing=page.getByRole('article',{name:'missing',exact:true});
      check((await missing.locator('.job-post-summary p').innerText()).includes('has not supplied the job description'),'Missing description remains explicitly unavailable');
      check(await missing.getByRole('button').count()===0,'Missing description does not open an empty full listing');
      const compact=page.getByRole('article',{name:'compact',exact:true});
      await compact.getByRole('button',{name:'Read full listing',exact:true}).click();
      const compactDialog=page.getByRole('dialog',{name:'Program specialist',exact:true});
      await compactDialog.waitFor();
      check((await compactDialog.getByRole('tabpanel').innerText()).includes('serving local residents'),'Compact cards also expose their full supplied text');
      await compactDialog.getByRole('button',{name:'Close listing',exact:true}).click();
      const actions=page.getByRole('region',{name:'Job detail actions',exact:true}).locator('.job-detail-actions');
      await actions.scrollIntoViewIfNeeded();
      check(await actions.locator('.btn').evaluateAll(elements=>elements.every(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=window.innerWidth&&box.height>=44&&element.scrollWidth<=element.clientWidth+1;})),'Real nested job actions wrap long source labels within the viewport with touch-sized targets');
      check(await actions.getByRole('link').getAttribute('href')==='https://example.com/jobs/care','Wrapping a long source label preserves the original job destination');
      await page.screenshot({path:path.join(output,`job-actions-${width}.png`)});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Cards and links fit without horizontal overflow');
      await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`overview-${width}.png`)});
      check(errors.length===0,'No component rendering errors');
      check(external.length===0,'No external provider requests');
      report.results.push({width,passed:true});
    } catch(error) { await page.screenshot({path:path.join(output,`failure-${width}.png`)});throw error; }
    finally { await context.close(); }
  }
  report.passed=true;console.log(`PASS: job role overviews/full supplied listings, ${report.checks} checks at 320/390/820/1440`);
} catch(error) {report.passed=false;report.error=error.message;throw error;}
finally {await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
