// Real routed pages and controls; synthetic accounts and publishing outcomes.
// All non-local network requests are blocked. No provider posts are sent.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember,auditNavigate,auditReload } from './audit-session.mjs';
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const catalog=require('../backend/business-industries.json');
const app=await createAppHarness();app.seedUser(member('industry-audit',{plan:'business',accountType:'business',businessIndustryId:'technology',businessEnrollment:{industryId:'technology'},organization:'Audit company'}));
const server=await startBuiltServer({port:0});
let browser;let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
try{
  await fs.mkdir('.cache/audit-ui',{recursive:true});
  const origin=server.origin+'/';browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [320,1440]){
    const context=await browser.newContext({viewport:{width,height:width===320?568:900},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);
    const errors=[],unexpectedMutations=[];page.on('pageerror',error=>errors.push(error.message));
    const workspaces=[],posts=[],requests=[];let canManage=true,linkedIn=true,failFirst=true,releaseSecondPage;
    const secondPageResponse=new Promise(resolve=>{releaseSecondPage=resolve;});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      const headers={'Access-Control-Allow-Origin':server.origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(!['fetch','xhr'].includes(request.resourceType()))return url.origin===server.origin?route.continue():route.abort();
      const endpoint=url.pathname.replace(/^\/(api|fallback)/,'');
      const fulfill=(json,status=200)=>route.fulfill({json,status,headers});
      if(['/analytics/pageview','/analytics/performance'].includes(endpoint))return fulfill({ok:true});
      if(endpoint==='/business/industries'){
        if(route.request().method()==='GET')return fulfill({catalog,workspaces,canManage});
        const body=route.request().postDataJSON();check(!body.ownerId,'Owner is never supplied by the browser');
        const existing=workspaces.find(item=>item.industryId===body.industryId);
        const workspace={id:existing?.id||`a0000000-0000-4000-8000-${String(workspaces.length+1).padStart(12,'0')}`,...body,createdAt:new Date().toISOString()};
        if(existing)workspaces.splice(workspaces.indexOf(existing),1,workspace);else workspaces.push(workspace);
        return fulfill({workspace});
      }
      const archiveMatch=endpoint.match(/^\/business\/industries\/([^/]+)$/);
      if(archiveMatch && request.method()==='PATCH'){
        const workspace=workspaces.find(item=>item.id===archiveMatch[1]);if(!workspace||!canManage)return fulfill({message:'Forbidden'},403);
        workspace.archivedAt=request.postDataJSON().archived?new Date().toISOString():null;return fulfill({workspace});
      }
      const postMatch=endpoint.match(/^\/business\/industries\/([^/]+)\/posts(?:\/([^/]+)(\/publish)?)?$/);
      if(postMatch){
        const workspace=workspaces.find(item=>item.id===postMatch[1]);
        if(route.request().method()==='GET'){
          const currentPage=Number(url.searchParams.get('page')||1);
          const status=url.searchParams.get('status')||'all',filtered=posts.filter(post=>status==='all'||post.status===status);
          if(currentPage===2)await secondPageResponse;
          return fulfill({workspace,posts:filtered.slice((currentPage-1)*12,currentPage*12),page:currentPage,hasMore:filtered.length>currentPage*12});
        }
        const body=route.request().postDataJSON();requests.push(body);
        if(postMatch[2]){
          const saved=posts.find(item=>item.id===postMatch[2]);if(!saved)return fulfill({message:'Not found'},404);
          if(postMatch[3] && saved.publishRequest===body.requestId)return fulfill(saved);
          if(saved.status!=='draft'||saved.version!==body.version)return fulfill({message:'This draft changed. Refresh history.'},409);
          if(request.method()==='DELETE'){posts.splice(posts.indexOf(saved),1);return fulfill({deleted:true,id:saved.id});}
          if(workspace.archivedAt)return fulfill({message:'Space archived'},409);
          if(request.method()==='PATCH')Object.assign(saved,{title:body.title,content:body.title+'\n\n'+body.content,mediaUrl:body.mediaUrl,version:saved.version+1,updatedAt:new Date().toISOString()});
          else if(postMatch[3])Object.assign(saved,{status:'published',canEdit:false,publishRequest:body.requestId,version:saved.version+1,targets:body.targets.map(platform=>({platform,status:'posted',postedUrl:'https://uficonnect.org/p/synthetic'}))});
          else return fulfill({message:'Unexpected mutation'},405);
          return fulfill(saved);
        }
        let post=posts.find(item=>item.requestId===body.requestId);
        if(!post){post={id:'bi_'+body.requestId,requestId:body.requestId,authorId:'industry-audit',authorName:'Audit company member',version:1,canEdit:!body.targets.length,title:body.title,content:body.title+'\n\n'+body.content,status:body.targets.length?'published':'draft',targets:body.targets.map(platform=>({platform,status:'posted',postedUrl:platform==='uficonnect'?'https://uficonnect.org/p/synthetic':'https://www.linkedin.com/feed/update/synthetic'})),createdAt:new Date().toISOString()};posts.unshift(post);}
        if(failFirst){failFirst=false;return fulfill({message:'Synthetic reply lost. Retry unchanged to check saved delivery.'},503);}
        return fulfill(post);
      }
      if(endpoint==='/social/platforms')return fulfill({connected:{linkedin:linkedIn},platforms:{linkedin:{configured:true,crossPost:{supported:true}}},businessPublishing:{photos:true}});
      if(/(?:events|stream)/.test(endpoint))return route.abort();
      // Unmocked app reads still use the local harness; no production API is contacted.
      if(request.method()!=='GET'){unexpectedMutations.push(endpoint);return fulfill({message:'Unexpected audit mutation'},403);}
      const response=await app.request(endpoint+url.search,{userId:'industry-audit'});
      return fulfill(response.data,response.status);
    });
    await installAuditMember(page,app,'industry-audit');await auditNavigate(page,origin+'recruiting');
    await page.getByRole('heading',{name:'Audit company recruiting',exact:true}).waitFor();
    await page.getByRole('navigation',{name:'Business workspace',exact:true}).getByRole('link',{name:'Industry spaces',exact:true}).click();
    await page.getByRole('heading',{name:'Industry spaces',exact:true}).waitFor();
    await page.getByLabel('Industry',{exact:true}).waitFor();
    check(await page.getByLabel('Industry',{exact:true}).inputValue()==='technology','Business signup industry is preselected for the first space');
    await page.getByLabel('Industry',{exact:true}).selectOption('technology');
    await page.getByLabel('Space name',{exact:true}).fill('Product team');
    await page.getByRole('checkbox',{name:'Stack Overflow',exact:true}).uncheck();
    await page.getByRole('button',{name:'Create industry space',exact:true}).click();
    await page.getByText('Industry space saved for your Business team.',{exact:true}).waitFor();
    check(workspaces.length===1&&workspaces[0].sourceIds.join(',')==='github','Only selected industry resources are saved');
    await auditReload(page);await page.getByRole('button',{name:'Resources & settings',exact:true}).click();
    check(await page.getByRole('checkbox',{name:'GitHub',exact:true}).isChecked(),'Saved resource selection survives reload');
    check(!await page.getByRole('checkbox',{name:'Stack Overflow',exact:true}).isChecked(),'Unselected resource stays unselected');
    const resource=page.getByRole('link',{name:'Visit GitHub',exact:true});check(await resource.getAttribute('href')==='https://github.com/','Resource links use the fixed official site');
    check(await resource.getAttribute('rel')==='noopener noreferrer','External resources isolate the opened page');
    const spaceId=workspaces[0].id;
    await auditNavigate(page,origin+'business/cross-post?workspace='+spaceId);
    await page.getByLabel('Post title',{exact:true}).fill('Product release');
    await page.getByLabel('Business update text',{exact:true}).fill('Our team completed the product release and welcomes your feedback.');
    const publicTarget=page.getByRole('checkbox',{name:/UFIconnect — public post/});
    check(!await publicTarget.isChecked(),'Public publishing starts unselected');
    check(await page.getByRole('button',{name:'Publish business update',exact:true}).isDisabled(),'Publishing requires explicit destination selection');
    await publicTarget.check();await page.getByRole('checkbox',{name:/^LinkedIn/}).check();
    await page.getByRole('button',{name:'Publish business update',exact:true}).click();
    await page.getByText('Synthetic reply lost. Retry unchanged to check saved delivery.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Publish business update',exact:true}).click();
    await page.getByText('Published to every selected destination.',{exact:true}).waitFor();
    check(requests.length===2&&requests[0].requestId===requests[1].requestId&&posts.length===1,'Retry retains idempotency after a lost response');
    check(requests[0].publicConfirmed===true,'The explicitly selected public target sends its confirmation');
    check(!requests[0].authorId&&!requests[0].ownerId,'Publishing does not supply an identity override');
    await auditReload(page);await page.getByLabel('Post title',{exact:true}).waitFor();
    check(await page.getByLabel('Post title',{exact:true}).inputValue()==='','Reload does not retain private composer text in browser storage');
    await page.locator('.industry-history-card').first().waitFor();
    check(requests.length===2&&posts.length===1,'Reload restores saved outcomes without issuing another publication');
    await page.getByLabel('Post title',{exact:true}).fill('Private planning draft');
    await page.getByLabel('Business update text',{exact:true}).fill('This saved draft is for my private preparation before choosing a public destination.');
    await page.getByRole('button',{name:'Save private draft',exact:true}).click();
    await page.getByText('Your private draft is saved in this space.',{exact:true}).waitFor();
    check(requests.at(-1).targets.length===0,'Saving a private draft selects no publishing destinations');
    const savedDraftId=posts.find(post=>post.status==='draft').id;
    await auditReload(page);await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('input[placeholder="What’s new with your team?"]')?.value==='Private planning draft');
    check(await page.getByLabel('Business update text',{exact:true}).inputValue()==='This saved draft is for my private preparation before choosing a public destination.','Editing a draft restores its text without duplicating the title');
    check(!await page.getByRole('checkbox',{name:/UFIconnect — public post/}).isChecked(),'Reusing a private draft requires a fresh public destination selection');
    await page.screenshot({path:`.cache/audit-ui/business-industry-composer-${width}.png`,fullPage:true});
    await page.getByLabel('Business update text',{exact:true}).fill('An edited private draft remains the same saved record until publication.');
    await page.getByRole('checkbox',{name:/UFIconnect — public post/}).check();
    check(await page.getByRole('button',{name:'Publish business update',exact:true}).isDisabled(),'Unsaved draft changes must be saved before publishing');
    await page.getByRole('button',{name:'Save draft changes',exact:true}).click();await page.getByText('Draft changes saved.',{exact:true}).waitFor();
    check(posts.length===2&&posts.find(post=>post.id===savedDraftId).version===2,'Editing updates the existing draft and its version');
    await page.getByRole('button',{name:'Publish business update',exact:true}).click();await page.getByText('Published to every selected destination.',{exact:true}).waitFor();
    check(posts.length===2&&posts.find(post=>post.id===savedDraftId).status==='published','Publishing a saved draft retains its record and does not create a copy');
    await page.getByRole('button',{name:'Start a new post',exact:true}).click();
    await page.getByLabel('Post title',{exact:true}).fill('Disposable private draft');await page.getByLabel('Business update text',{exact:true}).fill('This private draft is only for checking safe author-controlled deletion.');
    await page.getByRole('button',{name:'Save private draft',exact:true}).click();await page.getByText('Your private draft is saved in this space.',{exact:true}).waitFor();
    await page.getByLabel('Post status',{exact:true}).selectOption('draft');await page.getByRole('button',{name:'Delete draft',exact:true}).click();
    await page.getByRole('dialog',{name:'Delete private draft?',exact:true}).getByRole('button',{name:'Delete draft',exact:true}).click();
    await page.getByText('No private drafts match this filter.',{exact:true}).waitFor();check(posts.length===2,'Delete removes only the selected unpublished draft');
    await page.getByLabel('Post status',{exact:true}).selectOption('all');
    for(let i=0;i<13;i++)posts.push({id:'history-'+i,title:'History '+i,content:'Synthetic published update '+i,status:'published',targets:[],createdAt:new Date().toISOString()});
    await auditReload(page);const history=page.getByRole('region',{name:'Industry post history'});await history.locator('.industry-history-card').first().waitFor();
    check(await history.locator('.industry-history-card').count()===12,'History shows twelve posts per page');
    await history.getByRole('button',{name:'Next',exact:true}).click();
    await history.getByRole('status').filter({hasText:'Loading posts…'}).waitFor();
    check(await history.locator('.industry-history-card').count()===0,'Loading the next history page clears the previous rows');
    releaseSecondPage();
    const expectedSecondPage=posts.slice(12).map(post=>post.title);
    await history.getByRole('heading',{name:expectedSecondPage[0],exact:true}).waitFor();
    await history.getByText('Page 2',{exact:true}).waitFor();
    check(await history.locator('.industry-history-card').count()===posts.length-12,'History next page shows remaining posts');
    check(JSON.stringify(await history.locator('.industry-history-card h3').allTextContents())===JSON.stringify(expectedSecondPage),'History next page contains exactly the remaining post titles');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Industry publishing has no horizontal overflow');
    linkedIn=false;await auditReload(page);check(await page.getByRole('checkbox',{name:/^LinkedIn/}).isDisabled(),'Unavailable LinkedIn cannot be activated by the composer');
    posts.unshift({id:'uncertain',title:'Uncertain delivery',content:'Check the destination before creating another copy.',status:'unconfirmed',targets:[{platform:'linkedin',status:'unconfirmed'}],createdAt:new Date().toISOString()});
    await page.getByLabel('Post status',{exact:true}).selectOption('unconfirmed');await page.getByRole('heading',{name:'Uncertain delivery',exact:true}).waitFor();
    check(await page.locator('.industry-history-card').count()===1,'Status filters show only matching delivery history');
    check(await page.locator('.industry-history-card').getByRole('button').count()===0,'Uncertain publication has no resend, edit or delete action');
    await page.getByRole('button',{name:'Refresh history',exact:true}).click();await page.getByRole('heading',{name:'Uncertain delivery',exact:true}).waitFor();
    await auditNavigate(page,origin+'business/industries');await page.getByRole('button',{name:'Archive space',exact:true}).click();
    await page.getByRole('dialog',{name:'Archive industry space?',exact:true}).getByRole('button',{name:'Archive space',exact:true}).click();
    await page.getByText('Space archived. Its posts and private drafts remain available in history.',{exact:true}).waitFor();
    const historyCount=posts.length;check(Boolean(workspaces[0].archivedAt),'Owner can archive a space');
    await page.getByLabel('Show industry spaces',{exact:true}).selectOption('archived');await page.getByRole('link',{name:'View post history',exact:true}).click();
    await page.getByText(/This space is archived\. Its history is available below/).waitFor();check(await page.getByLabel('Post title',{exact:true}).count()===0,'Archived spaces retain history without a publishing composer');
    await page.getByRole('link',{name:'Manage industry spaces',exact:true}).click();await page.getByLabel('Show industry spaces',{exact:true}).selectOption('archived');
    await page.getByRole('button',{name:'Restore space',exact:true}).click();await page.getByRole('dialog',{name:'Restore industry space?',exact:true}).getByRole('button',{name:'Restore space',exact:true}).click();
    await page.getByText('Space restored. Your team can publish here again.',{exact:true}).waitFor();check(!workspaces[0].archivedAt&&posts.length===historyCount,'Restoring preserves every history record');
    await auditNavigate(page,origin+'business/cross-post?workspace=unowned');await page.getByText('This space is not available to your Business membership.',{exact:true}).waitFor();
    check(await page.getByLabel('Post title',{exact:true}).count()===0,'An unknown space does not silently select a different organization space');
    canManage=false;await auditNavigate(page,origin+'business/industries');await page.getByRole('button',{name:'View resources',exact:true}).click();
    check(await page.getByLabel('Space name',{exact:true}).isDisabled(),'Teammates cannot edit shared space names');
    check(await page.getByRole('checkbox',{name:'GitHub',exact:true}).isDisabled(),'Teammates cannot change shared resource selections');
    check(await page.getByRole('button',{name:'Save space settings',exact:true}).count()===0,'Teammates have no settings write action');
    check(await page.getByRole('button',{name:'Archive space',exact:true}).count()===0,'Teammates cannot archive shared spaces');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Industry resources have no horizontal overflow');
    await page.screenshot({path:`.cache/audit-ui/business-industries-${width}.png`,fullPage:true});
    check(errors.length===0,'No browser errors: '+errors.join('; '));
    check(unexpectedMutations.length===0,'Only expected local fixture mutations occur: '+unexpectedMutations.join('; '));
    await context.close();console.log('PASS: business industries at '+width+'px');
  }
  await fs.writeFile('.cache/audit-ui/business-industries-results.json',JSON.stringify({passed:true,checks,widths:[320,1440],externalActions:'none; all API requests intercepted or sent to the local fixture'},null,2));
  console.log('PASS: '+checks+' Business industry UI checks');
}finally{await browser?.close();await server.close();await app.close();}
