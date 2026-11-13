import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:4187,strictPort:true}});
const checks=[],errors=[];
let browser;
try {
  await server.listen();
  browser=await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{},headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  const visit=()=>page.goto('http://127.0.0.1:4187/tests/held-distribution.html');
  const panel=page.locator('.utr-distribution'),button=panel.getByRole('button',{name:'Distribute all assigned',exact:true});
  const refresh=async()=>{await panel.getByRole('button',{name:'Refresh assigned posts',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.utr-distribution-actions button:last-child').disabled);};
  await visit();
  await panel.getByText('0 assigned posts ready',{exact:true}).waitFor();
  assert.equal(await button.isDisabled(),true);
  await page.getByRole('button',{name:'View held posts',exact:true}).click();
  await page.getByRole('button',{name:'Individual posts',exact:true}).click();
  await page.getByRole('button',{name:/Retained Python post/}).click();
  await page.getByRole('button',{name:'Assign to topic',exact:true}).click();
  await panel.getByText('1 assigned post ready',{exact:true}).waitFor();
  assert.equal(await button.isEnabled(),true);
  await page.getByLabel('Find topics or posts',{exact:true}).fill('unrelated filter');
  await page.waitForFunction(()=>window.distributionFixture.requests.some(row=>row.path==='/office/topic-review'&&row.query.q==='unrelated filter'));
  await page.getByRole('button',{name:'Hide held posts',exact:true}).click();
  assert.equal(await button.isVisible(),true);
  checks.push('button is visible while review is collapsed, disabled before assignment, and enabled when assigned posts remain after the held queue empties');

  await page.evaluate(()=>{window.distributionFixture.pending=5;});await refresh();
  await button.click();
  await panel.getByText('Distribution complete',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/5 processed · 3 feed posts created and distributed · 2 screened out · 0 returned to review · 0 remaining/);
  const posts=await page.evaluate(()=>window.distributionFixture.posts);
  assert.equal(posts.length,3);assert.equal(new Set(posts.map(body=>body.through)).size,1);
  assert.deepEqual(Object.keys(posts[0]).sort(),['confirmed','through']);assert.equal(posts[0].confirmed,true);
  assert.equal(await button.isDisabled(),true);
  await page.screenshot({path:fileURLToPath(new URL('../../../held-distribution-results-desktop.png',import.meta.url)),fullPage:true});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('../../../held-distribution-results-mobile.png',import.meta.url)),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  checks.push('all assigned posts run across multiple batches using one fixed snapshot despite a review filter, and results distinguish distributed posts from screening rejections');

  await page.evaluate(()=>{window.distributionFixture.pending=5;window.distributionFixture.mode='partial';});await refresh();
  await button.click();
  await panel.getByRole('alert').filter({hasText:'A later batch failed'}).waitFor();
  assert.match(await panel.innerText(),/2 processed · 1 feed post created and distributed · 1 screened out · 0 returned to review · 3 remaining/);
  assert.equal(await page.evaluate(()=>window.distributionFixture.posts.length),4);
  checks.push('a partial server failure stops the loop while preserving completed counts and unprocessed remaining count');

  await page.evaluate(()=>{window.distributionFixture.mode='no-progress';});await refresh();
  await button.click();
  await panel.getByRole('alert').filter({hasText:'no further posts could be processed'}).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.distributionFixture.posts.length),5);
  checks.push('zero progress pauses after one request instead of looping');

  await page.evaluate(()=>{window.distributionFixture.mode='busy';});await refresh();
  await button.click();
  await panel.getByRole('alert').filter({hasText:'Another transfer is already running'}).waitFor();
  assert.equal(await page.evaluate(()=>window.distributionFixture.pending),3);
  checks.push('a busy transfer leaves all assigned posts available and reports the retryable error');

  await page.evaluate(()=>{window.distributionFixture.pending=5;window.distributionFixture.mode='hold';});await refresh();
  await button.click();await page.waitForFunction(()=>window.distributionFixture.waiting.length===1);
  assert.equal(await panel.getByRole('button',{name:'Distributing…',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'View held posts',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'Stop distribution after this batch',exact:true}).click();
  await page.evaluate(()=>window.distributionFixture.waiting.shift()());
  await panel.getByText('Distribution stopped',{exact:true}).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.distributionFixture.posts.length),7);
  checks.push('distribution locks duplicate starts and review actions; stop allows the current batch to finish without starting another');

  await page.evaluate(()=>{window.distributionFixture.pending=5;window.distributionFixture.mode='hold';});await refresh();
  await button.click();await page.waitForFunction(()=>window.distributionFixture.waiting.length===1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('office-token-changed'));window.distributionFixture.waiting.shift()();});
  await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(()=>window.distributionFixture.posts.length),8);
  assert.equal(await panel.locator('.utr-distribution-result').count(),0);
  checks.push('authentication changes clear protected results and suppress the pending response and any later batches');

  await page.evaluate(()=>{window.distributionFixture.mode='hold';});await refresh();
  await button.click();await page.waitForFunction(()=>window.distributionFixture.waiting.length===1);
  await page.evaluate(()=>window.switchDistributionApi());
  await page.evaluate(()=>window.distributionFixture.waiting.shift()());
  await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(()=>window.distributionFixture.posts.length),9);
  assert.equal(await panel.locator('.utr-distribution-result').count(),0);
  checks.push('changing API targets also suppresses stale distribution responses');

  await page.evaluate(()=>{window.distributionFixture.pending=1;window.distributionFixture.mode='return-review';});await refresh();
  await page.getByRole('button',{name:'View held posts',exact:true}).click();
  await page.getByRole('button',{name:'Individual posts',exact:true}).click();
  await page.getByText('0 matching posts',{exact:true}).waitFor();
  await button.click();
  await panel.getByText('Distribution complete',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/0 feed posts created and distributed · 0 screened out · 1 returned to review/);
  await page.getByText('1 matching posts',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Retained Python post/}).waitFor();
  checks.push('posts returned to review automatically appear in the open held list after distribution');
  await page.getByRole('button',{name:'Hide held posts',exact:true}).click();

  await page.setViewportSize({width:390,height:900});
  await panel.getByRole('button',{name:'Distribute all assigned',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('../../../held-distribution-mobile.png',import.meta.url)),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('../../../held-distribution-desktop.png',import.meta.url)),fullPage:true});
  assert.deepEqual(errors,[]);
  checks.push('desktop and mobile layouts render without browser errors or horizontal overflow');
  console.log(JSON.stringify({passed:true,checks},null,2));
} finally {await browser?.close();await server.close();}
