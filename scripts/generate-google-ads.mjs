// Builds the Google Ads assets in marketing/google-ads: product images rendered
// from the real web UI, logos, Google Ads Editor CSVs and a preview sheet.
//
//   node scripts/generate-google-ads.mjs              render images and CSVs
//   node scripts/generate-google-ads.mjs --copy-only  validate text, write CSVs
//   node scripts/generate-google-ads.mjs --check      verify committed output
//
// Screens use the audit harness with synthetic members, groups and jobs, so no
// real member data, third-party posts or production APIs appear in an ad.
// Set CHROMIUM_PATH to use a preinstalled Chromium instead of Playwright's.
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  businessName, searchCampaign, displayAssets, limits, imageSizes, maxImageBytes,
} from '../marketing/google-ads/campaign.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'marketing/google-ads');
const imageDir = path.join(output, 'images');
const editorDir = path.join(output, 'google-ads-editor');
const iconFile = path.join(output, 'ufi-icon-3d.svg');
const check = process.argv.includes('--check');
const copyOnly = process.argv.includes('--copy-only');

const THEMES = {
  people: { screen: 'feed', card: 'post', background: 'light' },
  communities: { screen: 'groups', card: 'group', background: 'navy' },
  opportunities: { screen: 'jobs', card: 'job', background: 'warm' },
};
const MARKETING_SIZES = ['landscape', 'square', 'portrait'];
const expectedImages = [
  ...Object.keys(THEMES).flatMap(theme => MARKETING_SIZES.map(size => ({ file: `${theme}-${size}.jpg`, size }))),
  { file: 'logo-square.png', size: 'logo-square' },
  { file: 'logo-landscape.png', size: 'logo-landscape' },
];

// ── Text validation ─────────────────────────────────────────────────────────
function validateCopy() {
  const problems = [];
  const within = (label, text, max) => {
    if (typeof text !== 'string' || !text.trim()) problems.push(`${label} is empty`);
    else if (text.length > max) problems.push(`${label} is ${text.length}/${max} characters: "${text}"`);
    if (/!{2,}|\?{2,}|\s{2,}/.test(text || '')) problems.push(`${label} repeats punctuation or spaces: "${text}"`);
  };
  const count = (label, items, [min, max]) => {
    if (items.length < min || items.length > max) problems.push(`${label} has ${items.length}, expected ${min}-${max}`);
    const seen = new Set();
    for (const item of items) {
      const key = item.toLowerCase();
      if (seen.has(key)) problems.push(`${label} repeats "${item}"`);
      seen.add(key);
    }
  };
  within('Business name', businessName, limits.businessName);
  for (const group of searchCampaign.adGroups) {
    const label = `Ad group "${group.name}"`;
    count(`${label} headlines`, group.headlines, limits.searchHeadlines);
    count(`${label} descriptions`, group.descriptions, limits.searchDescriptions);
    group.headlines.forEach((text, i) => {
      within(`${label} headline ${i + 1}`, text, limits.headline);
      if (text.includes('!')) problems.push(`${label} headline ${i + 1} contains "!", which headlines cannot use`);
    });
    group.descriptions.forEach((text, i) => within(`${label} description ${i + 1}`, text, limits.description));
    group.path.forEach((text, i) => { if (text.length > limits.path) problems.push(`${label} path ${i + 1} is too long`); });
    if (!group.keywords.length) problems.push(`${label} has no keywords`);
    if (!/^https:\/\/uficonnect\.org\//.test(group.finalUrl)) problems.push(`${label} final URL must be on https://uficonnect.org/`);
  }
  for (const link of searchCampaign.sitelinks) {
    within(`Sitelink "${link.text}"`, link.text, limits.sitelinkText);
    link.lines.forEach((line, i) => within(`Sitelink "${link.text}" line ${i + 1}`, line, limits.sitelinkLine));
  }
  if (new Set(searchCampaign.sitelinks.map(link => link.url)).size !== searchCampaign.sitelinks.length) {
    problems.push('Each sitelink needs its own final URL');
  }
  searchCampaign.callouts.forEach((text, i) => within(`Callout ${i + 1}`, text, limits.callout));
  searchCampaign.structuredSnippet.values.forEach((text, i) => within(`Snippet value ${i + 1}`, text, limits.snippetValue));
  count('Display headlines', displayAssets.headlines, limits.displayHeadlines);
  count('Display long headlines', displayAssets.longHeadlines, limits.displayLongHeadlines);
  count('Display descriptions', displayAssets.descriptions, limits.displayDescriptions);
  displayAssets.headlines.forEach((text, i) => within(`Display headline ${i + 1}`, text, limits.headline));
  displayAssets.longHeadlines.forEach((text, i) => within(`Display long headline ${i + 1}`, text, limits.longHeadline));
  displayAssets.descriptions.forEach((text, i) => within(`Display description ${i + 1}`, text, limits.description));
  if (!displayAssets.descriptions.some(text => text.length <= limits.shortDescription)) {
    problems.push(`Display needs one description of ${limits.shortDescription} characters or fewer`);
  }
  return problems;
}

// ── Google Ads Editor CSVs ───────────────────────────────────────────────────
// Everything imports paused so nothing spends before a person reviews it.
function csv(rows) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = value => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n';
}

function buildCsvs() {
  const campaign = searchCampaign.name;
  const campaigns = [{
    Campaign: campaign, 'Campaign Type': 'Search', Networks: 'Google search', Budget: searchCampaign.budget,
    'Budget type': 'Daily', 'Bid Strategy Type': searchCampaign.bidStrategy, Languages: searchCampaign.languages,
    'Campaign Status': 'Paused',
  }];
  const adGroups = searchCampaign.adGroups.map(group => ({ Campaign: campaign, 'Ad Group': group.name, 'Ad Group Status': 'Enabled' }));
  const keywords = [
    ...searchCampaign.adGroups.flatMap(group => group.keywords.map(([keyword, match]) => ({
      Campaign: campaign, 'Ad Group': group.name, Keyword: keyword, 'Criterion Type': match, Status: 'Enabled',
    }))),
    ...searchCampaign.negativeKeywords.map(keyword => ({
      Campaign: campaign, 'Ad Group': '', Keyword: keyword, 'Criterion Type': 'Campaign Negative Phrase', Status: 'Enabled',
    })),
  ];
  const ads = searchCampaign.adGroups.map(group => {
    const row = { Campaign: campaign, 'Ad Group': group.name, 'Ad type': 'Responsive search ad', Status: 'Enabled', 'Final URL': group.finalUrl };
    group.headlines.forEach((text, i) => { row[`Headline ${i + 1}`] = text; });
    for (let i = group.headlines.length; i < 15; i++) row[`Headline ${i + 1}`] = '';
    group.descriptions.forEach((text, i) => { row[`Description ${i + 1}`] = text; });
    for (let i = group.descriptions.length; i < 4; i++) row[`Description ${i + 1}`] = '';
    row['Path 1'] = group.path[0];
    row['Path 2'] = group.path[1];
    return row;
  });
  const sitelinks = searchCampaign.sitelinks.map(link => ({
    Campaign: campaign, 'Link Text': link.text, 'Description Line 1': link.lines[0], 'Description Line 2': link.lines[1], 'Final URL': link.url,
  }));
  const callouts = searchCampaign.callouts.map(text => ({ Campaign: campaign, 'Callout text': text }));
  const snippets = [{
    Campaign: campaign, Header: searchCampaign.structuredSnippet.header, Values: searchCampaign.structuredSnippet.values.join(';'),
  }];
  const display = [
    ...displayAssets.headlines.map(text => ({ 'Asset type': 'Headline', Text: text, Characters: text.length })),
    ...displayAssets.longHeadlines.map(text => ({ 'Asset type': 'Long headline', Text: text, Characters: text.length })),
    ...displayAssets.descriptions.map(text => ({ 'Asset type': 'Description', Text: text, Characters: text.length })),
    { 'Asset type': 'Business name', Text: businessName, Characters: businessName.length },
    { 'Asset type': 'Call to action', Text: displayAssets.callToAction, Characters: '' },
    { 'Asset type': 'Final URL', Text: displayAssets.finalUrl, Characters: '' },
    ...expectedImages.map(({ file, size }) => ({ 'Asset type': `Image (${size})`, Text: `images/${file}`, Characters: imageSizes[size].join('x') })),
  ];
  return {
    '1-campaign.csv': csv(campaigns), '2-ad-groups.csv': csv(adGroups), '3-keywords.csv': csv(keywords),
    '4-responsive-search-ads.csv': csv(ads), '5-sitelinks.csv': csv(sitelinks), '6-callouts.csv': csv(callouts),
    '7-structured-snippets.csv': csv(snippets), 'display-and-pmax-assets.csv': csv(display),
  };
}

// ── Image checks ────────────────────────────────────────────────────────────
function imageDimensions(buffer) {
  if (buffer.subarray(1, 4).toString() === 'PNG') return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  for (let offset = 2; offset < buffer.length - 9;) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5)];
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

async function checkImages() {
  const problems = [];
  for (const { file, size } of expectedImages) {
    const buffer = await fs.readFile(path.join(imageDir, file)).catch(() => null);
    if (!buffer) { problems.push(`Missing images/${file}`); continue; }
    const [width, height] = imageDimensions(buffer) || [];
    const [expectedWidth, expectedHeight] = imageSizes[size];
    if (width !== expectedWidth || height !== expectedHeight) problems.push(`images/${file} is ${width}x${height}, expected ${expectedWidth}x${expectedHeight}`);
    if (buffer.length > maxImageBytes) problems.push(`images/${file} is ${Math.round(buffer.length / 1024)} KB, over Google's 5,120 KB limit`);
  }
  return problems;
}

// ── Synthetic product data ──────────────────────────────────────────────────
// Names, groups and employers are fictional sample content for the renders.
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const samplePosts = [
  ['Priya N.', 'UX researcher', 'Career Growth', 'Just wrapped my first portfolio review in the Design Circle group. Three people offered to pair on case studies this week.', 24, 6],
  ['Marcus L.', 'Data analyst', 'AI & Machine Learning', 'Hosting an open Q&A on getting started with analytics careers on Thursday. Bring your questions.', 18, 9],
  ['Sofia R.', 'Community manager', 'Remote Work', 'What is one habit that keeps your remote team connected? Ours is a 10-minute Friday wins thread.', 41, 15],
  ['Daniel K.', 'Frontend engineer', 'Open Source', 'Looking for two collaborators for a small accessibility toolkit. Beginners welcome.', 12, 4],
].map(([name, title, topic, content, likesCount, commentsCount], i) => ({
  id: `ad-post-${i}`, source: 'uficonnect', title: '', content, topic, author: { id: `ad-author-${i}`, name, title },
  authorName: name, createdAt: minutesAgo(i * 17 + 4), likesCount, commentsCount,
}));
const featuredGroups = [
  ['Design Circle', 'Design', 'Portfolio reviews, critique and career advice for product designers.', 1284],
  ['Remote Work Hub', 'Remote Work', 'Remote roles, async habits and tools that help distributed teams work well.', 3402],
  ['AI Builders', 'AI & ML', 'Practical machine learning projects, papers and a weekly show-and-tell.', 2156],
  ['First-Time Founders', 'Startups', 'Honest conversations about starting, funding and growing a small company.', 978],
  ['Music Makers', 'Music', 'Share tracks, find collaborators and swap production tips.', 1530],
  ['Climate Action Circle', 'Climate', 'Local projects, green careers and practical ways to get involved.', 842],
];
const moreCategories = ['Engineering', 'Marketing', 'Finance', 'Education', 'Social', 'Health', 'Food', 'Travel', 'Gaming', 'Fashion', 'Lifestyle', 'Sports', 'Space'];
// 84 communities keeps the count consistent with the site's "80+ communities".
const sampleGroups = [
  ...featuredGroups,
  ...Array.from({ length: 84 - featuredGroups.length }, (_, i) => {
    const category = moreCategories[i % moreCategories.length];
    return [`${category} Community ${Math.floor(i / moreCategories.length) + 1}`, category, `Conversations about ${category.toLowerCase()}.`, 120 + i * 7];
  }),
].map(([name, category, description, members], i) => ({ id: `ad-group-${i}`, name, category, description, members, isPrivate: false, source: 'uficonnect' }));
const sampleJobs = [
  ['Product Designer', 'Harborlight Studio', 'Remote', 'Shape onboarding and profile experiences with a small, supportive design team.'],
  ['Data Analyst', 'Quillfield Analytics', 'Austin, TX', 'Turn community and product data into clear weekly insights for decision makers.'],
  ['Community Manager', 'Common Thread Collective', 'Remote', 'Grow welcoming spaces for members and run monthly online events.'],
  ['Frontend Engineer', 'Brightpine Labs', 'Remote', 'Build accessible React interfaces used by thousands of people every day.'],
  ['Marketing Coordinator', 'Cedarleaf & Co.', 'Chicago, IL', 'Plan campaigns, write newsletters and measure what resonates with customers.'],
  ['UX Writer', 'Fernwood Media', 'Remote', 'Write clear, friendly product copy and help shape a new content style guide.'],
].map(([title, org, location, content], i) => ({
  id: `ad-job-${i}`, title, org, location, content, remote: location === 'Remote', source: 'UFIconnect',
  sourceUrl: `https://example.org/jobs/${i}`, posted: minutesAgo(i * 1440 + 30), isLive: true, tags: [],
}));

// ── Screen capture ──────────────────────────────────────────────────────────
async function captureScreens(browser) {
  const require = createRequire(import.meta.url);
  require('../backend/generated-media');
  const { createAppHarness, member } = require('../backend/test-support/app-harness');
  const { createServer } = await import('../web/node_modules/vite/dist/node/index.js');
  const app = await createAppHarness({ connected: true });
  app.seedUser(member('ads-member', { name: 'Alex Morgan', title: 'Product designer' }));
  const proxy = prefix => ({ target: app.base, rewrite: value => value.replace(prefix, '') });
  const server = await createServer({
    root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false, logLevel: 'error',
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
    server: { host: '127.0.0.1', port: 5240, strictPort: false, proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
  });
  const shots = {};
  try {
    await server.listen();
    const base = server.resolvedUrls.local[0];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const routeApi = async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/(api|fallback)/, '');
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: samplePosts, total: samplePosts.length, hasMore: false, nativeUficonnectIncluded: true } });
      if (endpoint === '/groups') return route.fulfill({ json: { groups: sampleGroups } });
      if (endpoint === '/groups/categories') return route.fulfill({ json: { categories: [...new Set(sampleGroups.map(group => group.category))] } });
      if (endpoint === '/opportunities') return route.fulfill({ json: { opportunities: sampleJobs, hasMore: false, totalCount: sampleJobs.length, availableSources: ['UFIconnect'] } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    };
    await context.route('**/api/**', routeApi);
    await context.route('**/fallback/**', routeApi);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await installAuditMember(page, app, 'ads-member');
    // Park the pointer on the header's top edge so no card keeps a hover state
    // from the sign-in or dismiss clicks.
    const settle = async () => {
      await page.mouse.move(195, 1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
    };
    const png = buffer => `data:image/png;base64,${buffer.toString('base64')}`;
    // Centre a detail before clipping it so the sticky app header cannot cover it.
    const crop = async locator => {
      await locator.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await settle();
      return png(await page.screenshot({ clip: await locator.boundingBox() }));
    };
    const open = async (route, selector) => {
      await auditNavigate(page, base + route);
      await page.locator(selector).first().waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle();
    };

    await auditNavigate(page, base);
    await page.locator('.post-card').first().waitFor();
    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
    if (await dismiss.count()) await dismiss.first().click();
    // Start the screen at the member posts: the source bar above them shows
    // third-party logos, which do not belong in UFIconnect's own ads.
    await page.evaluate(() => {
      const header = [...document.querySelectorAll('header, .mobile-header, .topbar')].find(el => el.getBoundingClientRect().height > 0);
      const top = document.querySelector('.post-card').getBoundingClientRect().top;
      window.scrollBy(0, top - (header ? header.getBoundingClientRect().bottom : 0) - 14);
    });
    await settle();
    shots.feed = png(await page.screenshot());
    shots.post = await crop(page.locator('.post-card').nth(2));

    await open('groups', '.group-directory-tab');
    shots.groups = png(await page.screenshot());
    shots.group = await crop(page.locator('.group-directory-tab').first());

    await open('opportunities', '.job-result-tab');
    shots.jobs = png(await page.screenshot());
    shots.job = await crop(page.locator('.job-result-tab').first());
    await context.close();
  } finally {
    await server.close();
    await app.close();
  }
  return shots;
}

// ── Composition ─────────────────────────────────────────────────────────────
const FONT = "'Inter', 'Segoe UI', 'Liberation Sans', Arial, sans-serif";
const BACKGROUNDS = {
  light: { fill: 'linear-gradient(155deg, #F4F8FE 0%, #E3ECFA 55%, #D4E2F7 100%)', line: '#8FB0E6', dot: '#6F95D8', opacity: 0.55 },
  navy: { fill: 'radial-gradient(circle at 18% 12%, #2A4A9E 0%, rgba(42,74,158,0) 48%), linear-gradient(150deg, #16357F 0%, #102A6B 45%, #0B1E4D 100%)', line: '#8FB0E6', dot: '#B9CCF0', opacity: 0.28 },
  warm: { fill: 'radial-gradient(circle at 88% 92%, #FFE7CC 0%, rgba(255,231,204,0) 42%), linear-gradient(160deg, #F6F9FE 0%, #E8EEF9 60%, #F3EEF0 100%)', line: '#8FB0E6', dot: '#6F95D8', opacity: 0.5 },
};

// A seeded network of nodes and soft curves, echoing the homepage artwork
// without its third-party logos.
function networkSvg(width, height, seed, { line, dot, opacity }) {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const nodes = Array.from({ length: Math.round(width * height / 42000) + 8 }, () => [random() * width, random() * height]);
  const paths = [];
  const dots = [];
  for (const [x, y] of nodes) {
    const nearest = nodes.filter(node => node[0] !== x || node[1] !== y)
      .sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y)).slice(0, 2);
    for (const [nx, ny] of nearest) {
      const bend = (random() - 0.5) * 80;
      const cx = (x + nx) / 2 + bend;
      const cy = (y + ny) / 2 - bend;
      paths.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}"/>`);
      dots.push(`<circle cx="${((x + 2 * cx + nx) / 4).toFixed(1)}" cy="${((y + 2 * cy + ny) / 4).toFixed(1)}" r="3"/>`);
    }
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/>`);
  }
  return `<svg class="network" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="opacity:${opacity}">
    <g fill="none" stroke="${line}" stroke-width="1.4">${paths.join('')}</g><g fill="${dot}">${dots.join('')}</g></svg>`;
}

function phone(src, width, style) {
  const bezel = Math.round(width * 0.035);
  const screen = width - bezel * 2;
  const status = Math.round(screen * 0.12);
  const font = Math.round(screen * 0.042);
  return `<div class="phone" style="width:${width}px;padding:${bezel}px;border-radius:${Math.round(width * 0.15)}px;${style}">
    <div class="screen" style="border-radius:${Math.round(width * 0.125)}px">
      <div class="status" style="height:${status}px;font-size:${font}px;padding:0 ${Math.round(screen * 0.09)}px">
        <span>9:41</span><i class="island" style="width:${Math.round(screen * 0.3)}px;height:${Math.round(status * 0.62)}px"></i>
        <span class="battery" style="width:${Math.round(font * 1.7)}px;height:${Math.round(font * 0.8)}px"></span>
      </div>
      <img src="${src}" style="width:${screen}px;display:block">
    </div></div>`;
}

function card(src, width, style, framed = false) {
  const pad = framed ? Math.round(width * 0.02) : 0;
  return `<div class="float${framed ? ' framed' : ''}" style="width:${width}px;padding:${pad}px;${style}"><img src="${src}"></div>`;
}

// Layouts keep each detail card inside Google's 5% crop margins and never rotate
// or tile separate images; each ad is one phone with one detail from it.
function composition(theme, size, shots) {
  const { screen, card: detail, background } = THEMES[theme];
  const [width, height] = imageSizes[size];
  const bg = BACKGROUNDS[background];
  const framed = detail === 'group';
  const layout = {
    // The landscape phone runs off the bottom edge so it can stay legible.
    landscape: { phone: [340, 'left:730px;top:40px'], card: [framed ? 640 : 620, `left:${framed ? 110 : 130}px;top:50%;transform:translateY(-50%)`] },
    square: { phone: [470, 'left:620px;top:74px'], card: [framed ? 600 : 580, 'left:72px;top:600px'] },
    portrait: { phone: [450, 'left:440px;top:80px'], card: [framed ? 560 : 540, 'left:52px;top:700px'] },
  }[size];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width:${width}px; height:${height}px; overflow:hidden; position:relative; background:${bg.fill}; font-family:${FONT}; }
    .network { position:absolute; inset:0; }
    .phone { position:absolute; background:linear-gradient(145deg, #1F2937, #0B1220); box-shadow: 0 40px 80px rgba(11,30,77,.32), 0 12px 24px rgba(11,30,77,.18), inset 0 0 0 2px rgba(255,255,255,.08); }
    .screen { overflow:hidden; background:#fff; }
    .status { display:flex; align-items:center; justify-content:space-between; background:#fff; color:#0F172A; font-weight:700; }
    .island { background:#0B1220; border-radius:999px; }
    .battery { border:2px solid #0F172A; border-radius:4px; position:relative; }
    .battery::after { content:''; position:absolute; inset:2px 25% 2px 2px; background:#0F172A; border-radius:1px; }
    .float { position:absolute; border-radius:18px; overflow:hidden; background:#fff; box-shadow: 0 30px 60px rgba(11,30,77,.28), 0 8px 18px rgba(11,30,77,.14); }
    .float.framed { border:1px solid #DCE5F1; }
    .float img { display:block; width:100%; border-radius:12px; }
  </style></head><body>
    ${networkSvg(width, height, width * 7 + height * 13 + theme.length, bg)}
    ${phone(shots[screen], layout.phone[0], layout.phone[1])}
    ${card(shots[detail], layout.card[0], layout.card[1], framed)}
  </body></html>`;
}

// The UFI mark as geometric outlines (U, F, I in a 756×400 box), so the icon
// renders the same everywhere without a font. The letters span most of the
// tile with a shallow extrusion, over a dot grid and a faint network pattern.
const UFI_LETTERS = 'M0 0H100V235A65 65 0 0 0 230 235V0H330V235A165 165 0 0 1 0 235Z'
  + 'M366 0H626V100H466V175H591V265H466V400H366Z'
  + 'M656 0H756V400H656Z';

function mixColor(from, to, amount) {
  const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [channels(from), channels(to)];
  return '#' + a.map((value, i) => Math.round(value + (b[i] - value) * amount).toString(16).padStart(2, '0')).join('');
}

function ufiIconSvg(size = 1024) {
  const scale = 840 / 756;
  const steps = 16;
  const [stepX, stepY] = [0.9, 1];
  const x = (1024 - 756 * scale - steps * stepX) / 2;
  const y = (1024 - 400 * scale - steps * stepY) / 2;
  // Draw the extrusion back to front, darkening with depth.
  const depth = Array.from({ length: steps }, (_, i) => {
    const step = steps - i;
    const offset = `${(step * stepX / scale).toFixed(2)} ${(step * stepY / scale).toFixed(2)}`;
    return `<use xlink:href="#ufi-letters" transform="translate(${offset})" fill="${mixColor('#7F99D6', '#0F2663', (step - 1) / (steps - 1))}"/>`;
  }).join('\n      ');
  const network = networkSvg(1024, 1024, 20260928, { line: '#8FB0E6', dot: '#B9CCF0', opacity: 0.16 })
    .replace('<svg class="network"', '<svg');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="${size}" height="${size}">
  <title>UFIconnect</title>
  <defs>
    <radialGradient id="ufi-tile" cx="26%" cy="18%" r="100%">
      <stop offset="0" stop-color="#2A4FA8"/><stop offset=".5" stop-color="#132F76"/><stop offset="1" stop-color="#0A1B47"/>
    </radialGradient>
    <pattern id="ufi-dots" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="16" cy="16" r="1.6" fill="#FFFFFF" fill-opacity=".12"/>
    </pattern>
    <radialGradient id="ufi-vignette" cx="50%" cy="50%" r="72%">
      <stop offset=".6" stop-color="#050F2E" stop-opacity="0"/><stop offset="1" stop-color="#050F2E" stop-opacity=".45"/>
    </radialGradient>
    <linearGradient id="ufi-face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E2E9F6"/>
    </linearGradient>
    <filter id="ufi-shadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#030B24" flood-opacity=".45"/>
    </filter>
    <path id="ufi-letters" d="${UFI_LETTERS}"/>
  </defs>
  <rect width="1024" height="1024" fill="url(#ufi-tile)"/>
  <rect width="1024" height="1024" fill="url(#ufi-dots)"/>
  ${network}
  <rect width="1024" height="1024" fill="url(#ufi-vignette)"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">
    <g filter="url(#ufi-shadow)">
      ${depth}
    </g>
    <use xlink:href="#ufi-letters" fill="url(#ufi-face)"/>
  </g>
</svg>
`;
}

function logo(size) {
  const [width, height] = imageSizes[size];
  const body = size === 'logo-square'
    ? ufiIconSvg(width)
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:44px;background:#fff">
        <span style="width:200px;height:200px;border-radius:46px;overflow:hidden;display:block;box-shadow:0 10px 24px rgba(11,30,77,.25)">${ufiIconSvg(200)}</span>
        <span style="color:#102A6B;font-size:124px;font-weight:700;letter-spacing:-2px">UFIconnect</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>* { margin:0; box-sizing:border-box; } body { width:${width}px; height:${height}px; font-family:${FONT}; } svg { display:block; }</style></head><body>${body}</body></html>`;
}

function previewSheet() {
  const tile = ({ file, size }) => {
    const [width, height] = imageSizes[size];
    const scale = 360 / width;
    return `<figure><img src="images/${file}" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}"><figcaption>${file} · ${width}×${height}</figcaption></figure>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; padding:40px; width:1280px; background:#F8FAFC; font-family:${FONT}; color:#0F172A; }
    h1 { font-size:28px; margin:0 0 6px; } p { margin:0 0 28px; color:#64748B; font-size:16px; }
    .grid { display:flex; flex-wrap:wrap; gap:28px 40px; align-items:flex-start; }
    figure { margin:0; } img { display:block; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.12); background:#fff; }
    figcaption { font-size:13px; color:#64748B; margin-top:8px; }
  </style></head><body><h1>UFIconnect Google Ads image assets</h1>
  <p>Rendered from the web app with synthetic sample content. Regenerate with node scripts/generate-google-ads.mjs.</p>
  <div class="grid">${expectedImages.map(tile).join('')}</div></body></html>`;
}

async function renderImages() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const shots = await captureScreens(browser);
    await fs.mkdir(imageDir, { recursive: true });
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const theme of Object.keys(THEMES)) {
      for (const size of MARKETING_SIZES) {
        const [width, height] = imageSizes[size];
        await page.setViewportSize({ width, height });
        await page.setContent(composition(theme, size, shots), { waitUntil: 'load' });
        await page.screenshot({ path: path.join(imageDir, `${theme}-${size}.jpg`), type: 'jpeg', quality: 90 });
      }
    }
    for (const size of ['logo-square', 'logo-landscape']) {
      const [width, height] = imageSizes[size];
      await page.setViewportSize({ width, height });
      await page.setContent(logo(size), { waitUntil: 'load' });
      await page.screenshot({ path: path.join(imageDir, `${size}.png`) });
    }
    const sheet = path.join(output, 'preview.html');
    await fs.writeFile(sheet, previewSheet());
    await page.setViewportSize({ width: 1360, height: 800 });
    await page.goto(`file://${sheet}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(output, 'preview.jpg'), type: 'jpeg', quality: 82, fullPage: true });
    await fs.rm(sheet);
  } finally {
    await browser.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
const problems = validateCopy();
const csvFiles = buildCsvs();
if (check) {
  for (const [name, content] of Object.entries(csvFiles)) {
    const current = await fs.readFile(path.join(editorDir, name), 'utf8').catch(() => null);
    if (current !== content) problems.push(`google-ads-editor/${name} is out of date; run node scripts/generate-google-ads.mjs --copy-only`);
  }
  if (await fs.readFile(iconFile, 'utf8').catch(() => null) !== ufiIconSvg()) problems.push('ufi-icon-3d.svg is out of date; run node scripts/generate-google-ads.mjs --copy-only');
  problems.push(...await checkImages());
} else if (!problems.length) {
  await fs.mkdir(editorDir, { recursive: true });
  for (const [name, content] of Object.entries(csvFiles)) await fs.writeFile(path.join(editorDir, name), content);
  await fs.writeFile(iconFile, ufiIconSvg());
  if (!copyOnly) await renderImages();
  problems.push(...await checkImages());
}
if (problems.length) {
  console.error(problems.map(problem => `FAIL: ${problem}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${searchCampaign.adGroups.length} search ad groups, ${displayAssets.headlines.length + displayAssets.longHeadlines.length + displayAssets.descriptions.length} display text assets and ${expectedImages.length} images meet Google Ads limits`);
}
