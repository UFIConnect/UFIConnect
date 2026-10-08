import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {installAuditMember,auditNavigate} from './audit-session.mjs';
import accountDirectory from '../backend/account-directory.json' with {type:'json'};
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await createAppHarness({connected:true});
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
 define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:5291,strictPort:false,proxy:{'/api':{target:app.base,rewrite:value=>value.replace(/^\/api/,'')}}}});
let browser;
try {
 await server.listen();browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
 await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:950}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/feed/sources?*',route=>route.fulfill({json:{sources:[]}}));
  app.seedUser(member(`expanded-${width}`,{plan:'pro'}));
  await installAuditMember(page,app,`expanded-${width}`);
  await auditNavigate(page,server.resolvedUrls.local[0]+'connected-accounts');
  const accountCategories=page.getByRole('group',{name:'Account categories'});
  const selectAccountCategory=async name=>{
    await accountCategories.getByRole('button',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' \\d+$')}).click();
    await page.getByRole('heading',{name,exact:true}).waitFor();
  };
  assert.equal(await accountCategories.getByRole('button',{name:/^All(?: |$)/}).count(),0);
  await selectAccountCategory('Travel');
  await page.getByRole('link',{name:'Visit Airbnb website',exact:true}).waitFor();
  await selectAccountCategory('Career sites');
  await page.getByRole('link',{name:'Visit Indeed website',exact:true}).waitFor();
  await selectAccountCategory('News & Publishing');
  await page.getByRole('link',{name:'Visit Reuters website',exact:true}).waitFor();
  await page.getByRole('link',{name:'Visit BBC News website',exact:true}).waitFor();
  await page.getByRole('link',{name:'Visit AP News website',exact:true}).waitFor();
  for(const name of ['Career sites','Travel','Music & Audio'])await selectAccountCategory(name);
  await selectAccountCategory('Travel');
  assert.equal(await page.getByRole('link',{name:'Visit Airbnb website',exact:true}).getAttribute('href'),'https://www.airbnb.com/');
  assert.equal(await page.getByRole('link',{name:'Visit Airbnb website',exact:true}).getAttribute('rel'),'noopener noreferrer');
  assert.equal(await page.getByRole('combobox',{name:'Filter accounts'}).count(),0,'Account status filters are removed');
  const airbnb=page.locator('.account-platform-card').filter({has:page.getByText('Airbnb',{exact:true})});
  assert.equal(await airbnb.locator('.account-platform-card-actions').getByRole('link').count(),1,'Website-only providers have one website link');
  await airbnb.getByRole('button',{name:/Details/}).click();
  await airbnb.getByText(/Automatic account sync and publishing are unavailable/).waitFor();
  assert.equal(await airbnb.getByRole('button',{name:/Disconnect/}).count(),0,'A website visit does not link an account');
  const expandedCategories=[
    ['Social',['whatsapp','snapchat','nextdoor','quora','signal'],'Facebook'],
    ['Video & Streaming',['kick','dailymotion','netflix','disneyplus','primevideo','crunchyroll'],'YouTube'],
    ['Design',['canva','adobeexpress','artstation','deviantart','sketch','webflow'],'Canva'],
    ['Music & Audio',['applemusic','amazonmusic','youtubemusic','tidal','deezer','bandcamp'],'Spotify'],
  ];
  for(const [category,keys,firstName] of expandedCategories){
    await selectAccountCategory(category);
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(),[category],'Only the selected category is rendered');
    await page.locator('.account-platform-card').first().getByText(firstName,{exact:true}).waitFor();
    for(const key of keys){
      const provider=accountDirectory[key];
      const card=page.locator('.account-platform-card').filter({has:page.getByText(provider.name,{exact:true})});
      const website=card.getByRole('link',{name:`Visit ${provider.name} website`,exact:true});
      await website.waitFor();
      assert.equal(await website.getAttribute('href'),provider.siteUrl);
      assert.equal(await website.getAttribute('target'),'_blank');
      assert.equal(await website.getAttribute('rel'),'noopener noreferrer');
      assert.equal(await card.locator('.account-site-link').count(),1,'Each new card retains one official website action');
      assert.ok(await card.getByRole('button',{name:`Sign in and connect ${provider.name}`,exact:true}).isDisabled(),'Website visits do not grant account authorization');
      assert.equal(await card.locator('.account-platform-card-header > div').first().locator('img, svg').count(),1,'New providers use the existing brand icon presentation');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await page.screenshot({path:path.join(root,`.cache/audit-ui/expanded-accounts-${category.split(' ')[0].toLowerCase()}-${width}.png`)});
  }
  await auditNavigate(page,server.resolvedUrls.local[0]+'command-center?tab=crosspost');
  const category=page.getByRole('combobox',{name:'Publishing category'});
  await category.waitFor();
  assert.equal(await category.locator('option[value="all"]').count(),0);
  await category.selectOption('career');
  await page.getByRole('link',{name:'Visit We Work Remotely website',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Visit Airbnb website',exact:true}).count(),0);
  await page.locator('textarea').fill('Our recruiting team is hiring. Review the role on our careers page.');
  assert.ok(await page.getByRole('button',{name:'Copy draft',exact:true}).first().isEnabled());
  await category.selectOption('travel');
  await page.getByRole('link',{name:'Visit Expedia website',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Visit We Work Remotely website',exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:path.join(root,`.cache/audit-ui/crosspost-travel-${width}.png`)});
  await auditNavigate(page,server.resolvedUrls.local[0]+'sources');
  await page.getByRole('switch',{name:'Turn off We Work Remotely',exact:true}).waitFor();
  await page.getByRole('switch',{name:'Turn off Condé Nast Traveler',exact:true}).waitFor();
  await page.getByRole('heading',{name:'News publishers',exact:true}).waitFor();
  await page.getByRole('link',{name:'Visit CNN website',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:/Reuters|CNN|New York Times/}).count(),0,'Publisher accounts do not promise unsupported feed synchronization');
  assert.equal(await page.getByRole('switch',{name:/Airbnb/}).count(),0,'Unsupported websites do not advertise feed sync');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await auditNavigate(page,server.resolvedUrls.local[0]+'onboarding');
  await page.locator('input[placeholder*="Search roles"]').fill('software enginer');
  await page.getByRole('button',{name:/Software Engineer/}).first().click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search topics',exact:true}).fill('travel');
  const topic=page.locator('.topic-picker-grid button').first();
  await topic.waitFor();const topicName=await topic.innerText();
  await topic.click();assert.equal(await topic.getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:`Remove ${topicName.trim()}`,exact:true}).click();
  assert.equal(await topic.getAttribute('aria-pressed'),'false');
  await page.getByRole('button',{name:'Browse all',exact:true}).click();
  assert.equal(await page.locator('.topic-picker-grid button').count(),36);
  const firstPage=await page.locator('.topic-picker-grid button').allTextContents();
  const pagination=page.getByRole('navigation',{name:'Topic pages'});
  assert.ok(await pagination.getByRole('button',{name:'Previous',exact:true}).isDisabled());
  await pagination.getByRole('button',{name:'Next',exact:true}).click();
  assert.equal(await page.locator('.topic-picker-grid button').count(),36);
  assert.ok(!(await page.locator('.topic-picker-grid button').allTextContents()).some(topic=>firstPage.includes(topic)));
  await pagination.getByRole('button',{name:'Previous',exact:true}).click();
  assert.deepEqual(await page.locator('.topic-picker-grid button').allTextContents(),firstPage);
  await page.getByRole('searchbox',{name:'Search topics',exact:true}).fill('cybersecurty');
  await page.locator('.topic-picker-grid').getByRole('button',{name:/Cybersecurity/i}).first().waitFor();
  await page.getByRole('button',{name:'Browse all',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:path.join(root,`.cache/audit-ui/signup-topics-${width}.png`)});
  await auditNavigate(page,server.resolvedUrls.local[0]+'register');
  await page.locator('input[name="name"]').fill('Test Member');await page.locator('input[name="email"]').fill('roles@example.invalid');
  await page.locator('input[name="password"]').fill('TestOnly12345!');await page.locator('input[name="confirmPassword"]').fill('TestOnly12345!');
  await page.getByRole('button',{name:'Continue →',exact:true}).click();
  await page.getByRole('searchbox',{name:'Find your role',exact:true}).fill('RN');
  await page.locator('.signup-role-results').getByRole('button',{name:/^Registered Nurse/}).click();
  assert.equal(await page.locator('input[placeholder="Search or type your exact title…"]').inputValue(),'Registered Nurse');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  app.seedUser(member(`business-${width}`,{plan:'business'}));
  await installAuditMember(page,app,`business-${width}`);
  await auditNavigate(page,server.resolvedUrls.local[0]+'career-posts');
  await page.getByRole('heading',{name:'Cross Post',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:/UFIConnect/}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Visit Reuters website',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).count(),0,'Manual career publishing has no automatic Send action');
  assert.equal(await page.getByRole('link',{name:'Visit Airbnb website',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log(`PASS source catalog, career/travel Cross Post, Business isolation, signup search and topics at ${width}px`);
  await context.close();
 }
}finally{await browser?.close();await server.close();await app.close();}
