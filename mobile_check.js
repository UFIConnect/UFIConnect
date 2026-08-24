const { chromium, devices } = require('C:/Users/Yosuf/AppData/Roaming/npm/node_modules/playwright');
(async () => {
  const iPhone = devices['iPhone 14'];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();

  await page.goto('https://uficonnect.org/login', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'test@ufi.dev');
  await page.fill('input[type=password]', 'Test1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'mobile_after_login.png' });

  await page.goto('https://uficonnect.org/feed', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'mobile_feed.png' });

  await page.goto('https://uficonnect.org/profile', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'mobile_profile.png' });

  await page.goto('https://uficonnect.org/groups', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'mobile_groups.png' });

  await page.goto('https://uficonnect.org/search', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'mobile_search.png' });

  await browser.close();
  console.log('done');
})().catch(e => { console.error(e.message); process.exit(1); });
