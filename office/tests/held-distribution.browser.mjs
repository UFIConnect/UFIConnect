import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../',import.meta.url));
const server = await createServer({root,server:{host:'127.0.0.1',port:4187,strictPort:true}});
const checks = [], errors = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{},
    executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error => errors.push(error.message));
  const panel = page.getByLabel('Assigned held posts',{exact:true});
  const button = panel.getByRole('button',{name:'Distribute all assigned',exact:true});
  const refresh = () => panel.getByRole('button',{name:'Refresh assigned posts',exact:true}).click();
  const step = () => page.evaluate(() => window.distributionFixture.step());
  const starts = () => page.evaluate(() => window.distributionFixture.requests.filter(row => row.path === '/office/topic-review/jobs/distribution'));
  const ready = async count => {
    await page.evaluate(value => { window.distributionFixture.pending = value; },count);
    await refresh();
    await button.waitFor();
    await page.waitForFunction(() => !document.querySelector('.utr-distribution-actions button:first-child').disabled);
  };
  await page.goto('http://127.0.0.1:4187/tests/held-distribution.html');
  await panel.getByText('0 assigned posts ready',{exact:true}).waitFor();
  assert.equal(await button.isDisabled(),true);
  await page.evaluate(() => { window.distributionFixture.missingStaging = 2; });
  await refresh();
  await panel.getByText('2 assignments without staging copies need reconciliation.').waitFor();
  assert.equal(await button.isDisabled(),true);
  await page.getByRole('button',{name:'View held posts',exact:true}).click();
  await page.getByRole('button',{name:'Individual posts',exact:true}).click();
  await page.getByRole('button',{name:/Retained Python post/}).click();
  await page.getByRole('button',{name:'Assign to topic',exact:true}).click();
  await panel.getByText('1 assigned post ready',{exact:true}).waitFor();
  await page.getByLabel('Find topics or posts',{exact:true}).fill('unrelated filter');
  await page.waitForFunction(() => window.distributionFixture.requests.some(row => row.path === '/office/topic-review' && row.query.q === 'unrelated filter'));
  await page.getByRole('button',{name:'Hide held posts',exact:true}).click();

  await ready(5);
  await button.click();
  await panel.getByText('Distribution in progress',{exact:true}).waitFor();
  assert.equal((await starts()).length,1);
  assert.deepEqual(Object.keys((await starts())[0].body).sort(),['confirmed','id']);
  await page.evaluate(() => window.unmountDistributionFixture());
  await panel.waitFor({state:'detached'});
  for (let i=0;i<3;i++) await step();
  await page.evaluate(() => window.mountDistributionFixture());
  await panel.getByText('Distribution complete',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/5 processed · 3 written to the live feed cache · 2 screened out · 0 returned to review · 0 remaining/);
  assert.equal((await starts()).length,1);
  assert.equal(await button.isDisabled(),true);
  await page.evaluate(() => {
    Object.assign(window.distributionFixture.job.progress, {transferred:1,preserved:1,conflicts:1});
  });
  await refresh();
  await panel.getByText('1 already live · 1 destination conflict.').waitFor();
  checks.push('missing staging and preserved or conflicting live copies have separate counts');
  checks.push('one confirmation covers all batches, and reopening the panel loads the completed run');

  await ready(5);
  await button.click();
  await panel.getByText('Distribution in progress',{exact:true}).waitFor();
  await page.evaluate(() => { window.distributionFixture.mode = 'busy'; });
  await step();
  await panel.getByText('Waiting for staging transfer',{exact:true}).waitFor();
  await page.evaluate(() => { window.distributionFixture.mode = 'ok'; });
  await step();
  await panel.getByText(/2 processed/).waitFor();
  await panel.getByRole('button',{name:'Stop distribution after this batch',exact:true}).click();
  await panel.getByRole('button',{name:'Stopping after this batch…',exact:true}).waitFor();
  await step();
  await panel.getByText('Distribution stopped',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/3 remaining in this run/);
  assert.equal((await starts()).length,2);
  checks.push('progress, busy transfer and stop reflect server status without a second start');

  await ready(3);
  await button.click();
  await panel.getByText('Distribution in progress',{exact:true}).waitFor();
  await page.evaluate(() => {
    window.distributionFixture.authorized = false;
    window.dispatchEvent(new Event('office-token-changed'));
  });
  await panel.getByRole('alert').filter({hasText:'Office access required.'}).waitFor();
  assert.equal(await panel.locator('.utr-distribution-result').count(),0);
  await step(); await step();
  await page.evaluate(() => {
    window.distributionFixture.authorized = true;
    window.dispatchEvent(new Event('office-token-changed'));
  });
  await panel.getByText('Distribution complete',{exact:true}).waitFor();
  assert.equal((await starts()).length,3);
  checks.push('access changes clear protected results and a confirmed server job continues');

  await ready(1);
  await page.getByRole('button',{name:'View held posts',exact:true}).click();
  await page.getByRole('button',{name:'Individual posts',exact:true}).click();
  await page.getByText('0 matching posts',{exact:true}).waitFor();
  await button.click();
  await panel.getByText('Distribution in progress',{exact:true}).waitFor();
  await page.evaluate(() => { window.distributionFixture.mode = 'return-review'; });
  await step();
  await panel.getByText('Distribution complete',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/0 written to the live feed cache · 0 screened out · 1 returned to review/);
  await page.getByText('1 matching posts',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Retained Python post/}).waitFor();

  await page.evaluate(() => window.switchDistributionApi());
  await panel.getByText('0 assigned posts ready',{exact:true}).waitFor();
  assert.equal(await panel.locator('.utr-distribution-result').count(),0);
  assert.equal((await starts()).length,4);
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  checks.push('returned posts refresh the open review list and switching API targets clears prior results');
  console.log(JSON.stringify({passed:true,checks},null,2));
} finally { await browser?.close(); await server.close(); }
