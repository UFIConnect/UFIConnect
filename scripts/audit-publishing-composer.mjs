import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const { normalizeDetails } = require('../backend/business-posts');
const app = await createAppHarness();
for (const plan of ['pro','business']) app.seedUser(member(`composer-${plan}`, {plan,accountType:plan==='business'?'business':'personal',organization:'Preview company'}));
// Keep sign-in and the intercepted /profile route on the same synthetic
// membership. Membership-store behavior has separate backend route tests.
const auditSession = { token: id => app.token(id), request: async (_path, { userId }) => ({ status: 200, data: app.fullProfile(app.users.find(user => user.id === userId)) }) };
const server = await startBuiltServer({port:0});
const photo = await fs.readFile('web/public/media/preparation/professional-introduction.png');
const photoUrl = 'https://res.cloudinary.com/composer-fixture/image/upload/photo.png';
const browser = await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
let checks = 0;
function check(condition,message) {assert.ok(condition,message);checks++;}
await fs.mkdir('.cache/audit-ui',{recursive:true});
try {
  for(const plan of (process.env.UFI_PUBLISHING_AUDIT_PLAN ? [process.env.UFI_PUBLISHING_AUDIT_PLAN] : ['pro','business'])) for(const width of [1440,390,320]) {
    const context = await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',colorScheme:width===390?'dark':'light'});
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const writes=[],errors=[],posts=[];
    let uploadCount=0;
    const history=[{id:'old',content:'A reusable update',targets:[{platform:'linkedin',status:'posted'}],createdAt:'2026-10-08T10:00:00Z'}];
    let releaseNative = null;
    const nativeGate = plan==='pro' && width===1440 ? new Promise(resolve=>{releaseNative=resolve;}) : null;
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      const headers={'Access-Control-Allow-Origin':server.origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*'};
      if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
      if(request.resourceType()==='image' && url.hostname==='res.cloudinary.com') return route.fulfill({body:photo,contentType:'image/png'});
      if(url.hostname==='api.cloudinary.com') {uploadCount++;return route.fulfill({headers,json:{secure_url:photoUrl,resource_type:'image'}});}
      if(!['xhr','fetch'].includes(request.resourceType())) return url.origin===server.origin?route.continue():route.abort();
      const endpoint=url.pathname.replace(/^\/(api|fallback)/,'');
      const fulfill=json=>route.fulfill({headers,json});
      if(endpoint==='/profile') return fulfill(app.fullProfile(app.users.find(user=>user.id===`composer-${plan}`)));
      if(endpoint==='/billing/status') return fulfill({plan,businessSeats:1});
      if(endpoint==='/social/platforms') return fulfill({businessPublishing:{photos:plan==='business'},connected:{linkedin:true,twitter:true,instagram:true},platforms:{
        linkedin:{name:'LinkedIn',configured:true,crossPost:{supported:true,media:'native-image'}},
        twitter:{name:'X (Twitter)',configured:true,crossPost:{supported:true,media:'link'}},
        instagram:{name:'Instagram',configured:true,crossPost:{supported:true,requiresPhoto:true,media:'native-image'}},
      }});
      if(endpoint==='/media/upload-signature') return fulfill({apiKey:'fixture',timestamp:1,signature:'fixture',folder:'crossposts',cloudName:'composer-fixture'});
      if(endpoint==='/command-center/cross-post/history') return fulfill({posts:history});
      if(endpoint==='/business/posts' && request.method()==='POST') {
        const body=request.postDataJSON(); writes.push({endpoint,body});
        const normalized=normalizeDetails(body.details,{validatePhoto:value=>value===photoUrl});
        const post={id:'composer-post-'+posts.length,...normalized,status:body.targets.length?'published':'draft',createdAt:'2026-10-08T10:00:00Z',targets:body.targets.map(platform=>({platform,status:'posted'})),metrics:{likes:null,comments:null,views:null}};
        posts.push(post);return fulfill(post);
      }
      if(endpoint==='/business/posts') return fulfill({posts,hasMore:false});
      if(request.method()==='POST' && ['/groups/ufi-general/posts','/command-center/cross-post'].includes(endpoint)) {
        const body=request.postDataJSON(); writes.push({endpoint,body});
        if(endpoint.includes('/groups/')) {if(nativeGate) await nativeGate;return fulfill({post:{id:'composer-native'}});}
        const targets=body.platforms.map(platform=>({platform,status:'posted'}));
        history.unshift({id:'composer-external',content:body.content,mediaUrl:body.mediaUrl,targets,createdAt:'2026-10-08T10:00:00Z'});
        return fulfill({id:'composer-external',targets,historySaved:true,mediaUrl:body.mediaUrl});
      }
      return fulfill({posts:[],items:[],sources:[],members:[],invitations:[]});
    });
    await installAuditMember(page,auditSession,`composer-${plan}`);
    await auditNavigate(page,server.origin+(plan==='business'?'/career-posts':'/command-center?tab=crosspost'));
    // Business sign-in may finish its workspace redirect after history-based
    // audit navigation. Follow the actual workspace link once signed in.
    if(plan==='business') await page.getByRole('link',{name:'Hiring cross-post',exact:true}).first().click();
    const editor=page.getByRole('textbox',{name:plan==='business'?'Role description':'Post draft',exact:true});
    try { await editor.waitFor(); }
    catch (failure) {
      await page.screenshot({path:`.cache/audit-ui/publishing-failure-${plan}-${width}.png`,fullPage:true});
      console.error(JSON.stringify({plan,width,url:page.url(),body:(await page.locator('body').innerText()).slice(0,3000),errors}));
      throw failure;
    }
    if(plan==='business') {
      await page.getByLabel('Role title',{exact:true}).fill('Software engineer');
      await editor.fill('Build reliable products with our engineering team.');
      await page.getByRole('textbox',{name:'Responsibilities — one per line',exact:true}).fill('Design APIs\nMaintain services');
      await page.getByRole('textbox',{name:'Requirements — one per line',exact:true}).fill('JavaScript');
      await page.locator('button.source-button').filter({hasText:'LinkedIn'}).first().click();
      check(await page.getByLabel('Hiring post checklist').isVisible(),'Business checklist visible');
    } else {
      await page.getByLabel('Post draft template').selectOption('Event');
      check((await editor.inputValue()).includes('How to join:'),'Template inserts usable plain text');
      await editor.fill('First task\nSecond task');
      await editor.evaluate(element=>{element.focus();element.setSelectionRange(0,element.value.length);});
      await page.getByRole('button',{name:'Add bullets to Post draft',exact:true}).click();
      check(await editor.inputValue()==='• First task\n• Second task','Writing toolbar preserves complete selected lines');
      await page.getByRole('button',{name:'UFIConnect: Connected',exact:true}).click();
      await page.getByRole('button',{name:'X (Twitter): Connected',exact:true}).click();
      await editor.fill('x'.repeat(300));
      check(await page.getByRole('button',{name:'Publish to 1 ready destination',exact:true}).isEnabled(),'An overlong Twitter selection does not block the ready native destination');
      check(await page.getByRole('region',{name:'Pending destinations',exact:true}).getByText(/Shorten this draft to 280/).isVisible(),'The overlong provider is explicitly pending');
      await page.getByRole('button',{name:'UFIConnect: Connected',exact:true}).click();
      check(await page.getByRole('button',{name:/^Publish to \d+ ready destinations?$/}).isDisabled(),'Overlong destination text cannot publish');
      await page.getByRole('button',{name:'UFIConnect: Connected',exact:true}).click();
      check(await editor.inputValue()==='x'.repeat(300),'Validation never truncates the draft');
      await editor.fill('A useful update for our community.');
      await page.getByRole('button',{name:'X (Twitter): Connected',exact:true}).click();
      await page.getByRole('combobox',{name:'Publishing category'}).selectOption('work');
      await page.getByRole('button',{name:'LinkedIn: Connected',exact:true}).click();
    }
    const emptyPhoto=page.getByRole('region',{name:'Post photo',exact:true});
    const drop=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['text'],'invalid.txt',{type:'text/plain'}));return transfer;});
    await emptyPhoto.dispatchEvent('drop',{dataTransfer:drop});
    await page.getByText(plan==='business'?'Choose a photo file.':'Choose a photo or video file.',{exact:true}).waitFor();
    check(uploadCount===0,'Non-photo drop cannot start an upload');
    await page.locator('.publish-photo input[type=file]').first().setInputFiles({name:'team-photo.png',mimeType:'image/png',buffer:photo});
    await page.getByAltText('Selected for cross-posting',{exact:true}).waitFor();
    check(await page.getByAltText('Post photo preview',{exact:true}).isVisible(),'Uploaded image appears in live preview');
    check(uploadCount===1,'One upload made');
    await page.getByRole('button',{name:'Remove photo',exact:true}).click();
    check(await page.getByAltText('Post photo preview',{exact:true}).count()===0,'Removal clears preview and attachment');
    await page.locator('.publish-photo input[type=file]').first().setInputFiles({name:'team-photo.png',mimeType:'image/png',buffer:photo});
    await page.getByAltText('Selected for cross-posting',{exact:true}).waitFor();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`.cache/audit-ui/publishing-${plan}-${width}.png`,fullPage:true});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`Composer fits ${width}px`);
    check(await page.evaluate(()=>document.documentElement.dataset.theme)===(width===390?'dark':'light'),'Composer follows device theme');
    check(await editor.evaluate(element=>getComputedStyle(element).backgroundColor)===await page.locator('.publish-preview').evaluate(element=>getComputedStyle(element).backgroundColor),'Editor and preview share the same themed surface');
    const draft=await editor.inputValue();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download text',exact:true}).click();
    const exported=await download;
    const saved=await fs.readFile(await exported.path(),'utf8');
    check(saved.includes(draft),'Download retains the complete writing');
    if(plan==='pro') {
      await page.getByRole('tab',{name:'Connected Accounts',exact:true}).click();
      await page.getByRole('tab',{name:'Cross-Post',exact:true}).click();
      await editor.waitFor();
      check(await editor.inputValue()===draft,'Personal draft survives tab navigation');
      await page.getByRole('button',{name:/^Publish to \d+ ready destinations?$/}).click();
      if(releaseNative) {
        await page.waitForFunction(()=>document.querySelector('[form="ufi-crosspost-compose"]')?.disabled===true);
        await page.getByRole('tab',{name:'Connected Accounts',exact:true}).click();
        await page.getByRole('tab',{name:'Cross-Post',exact:true}).click();
        await editor.waitFor();
        check(await page.getByRole('button',{name:'Publishing…',exact:true}).isDisabled(),'Returning during delivery cannot send the draft again');
        releaseNative();
        await page.getByRole('button',{name:/^Publish to \d+ ready destinations?$/}).waitFor();
        check(await editor.inputValue()===draft,'Navigating away retains the draft for its unsent external destination');
        check(await page.getByRole('button',{name:'UFIConnect: Connected',exact:true}).getAttribute('aria-pressed')==='false','The accepted native receipt is deselected after navigation');
        check(writes.length===1,'Unmounting the composer cannot start an additional external request');
        await page.getByRole('button',{name:'Publish to 1 ready destination',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Post draft"]')?.value==='');
        check(await editor.inputValue()==='','Explicitly resuming the remaining destination clears the delivered draft');
      } else await page.getByRole('heading',{name:'Result',exact:true}).waitFor();
      check(writes.length===2,'Personal photo published once to native and external endpoints');
      for(const {body} of writes) check(body.mediaUrl===photoUrl && body.mediaType==='image','Each destination receives the selected photo');
      await page.getByRole('button',{name:'Reuse as draft',exact:true}).first().click();
      check((await editor.inputValue()).includes('A useful update'),'A published post can become a new draft');
    } else {
      await page.getByRole('button',{name:'Save draft',exact:true}).click();
      await page.getByText('Draft saved. You can find it in Posts & comparisons.',{exact:true}).waitFor();
      check(writes[0].body.details.mediaUrl===photoUrl && writes[0].body.targets.length===0,'Business saves the photo without publishing');
      await editor.fill(draft+' We welcome your application.');
      await page.getByRole('button',{name:'Publish hiring post',exact:true}).click();
      await page.getByText('Your hiring post was published. Review each destination below.',{exact:true}).waitFor();
      check(writes[1].body.details.mediaUrl===photoUrl,'Business publish retains the photo');
      check(JSON.stringify(writes[1].body.targets)==='["uficonnect","linkedin"]','Business photo destinations remain recruiting accounts');
      await page.getByRole('button',{name:'Start new post',exact:true}).click();
      check(await editor.inputValue()==='' && await page.getByAltText('Post photo preview',{exact:true}).count()===0,'New Business post clears writing and photo');
    }
    check(errors.length===0,`No runtime errors: ${errors.join('; ')}`);
    await context.close();
    console.log(`PASS: ${plan} composer editing, previews, photo upload and publishing at ${width}px`);
  }
  console.log(`PASS: ${checks} publishing composer checks.`);
} finally {await browser.close();await server.close();await app.close();}
