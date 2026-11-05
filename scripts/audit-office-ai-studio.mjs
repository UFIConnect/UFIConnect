import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://studio-api.invalid', token = 'synthetic-studio-access';
const fixturePath = path.join(root, 'office/.cache/studio-fixture.jsx');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(path.dirname(fixturePath), { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(fixturePath, `import React from 'react';import {createRoot} from 'react-dom/client';
import OfficeAIStudio from '../src/OfficeAIStudio.jsx';import OfficeAI from '../src/OfficeAI.jsx';
const request=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'x-office-token':'${token}'}});
const full=new URL(location.href).searchParams.has('full');
createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1380,margin:'auto'}}>{full?<OfficeAI apiBase='${API}' request={request}/>:<div className='office-ai'><OfficeAIStudio apiBase='${API}' request={request}/></div>}</main>);`);
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false, cacheDir: path.join(root, '.cache/audit-studio-vite'),
  server: { host: '127.0.0.1', port: 5271, strictPort: false }, plugins: [{ name: 'studio-audit', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/studio-audit') return next();
    res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/studio-audit', '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/studio-fixture.jsx"></script></body></html>'));
  }); } }] });
const capabilities = { photo: true, video: true, movie: true, planning: true, chapterSeconds: 120, customDuration: true, continuable: true, note: 'Movies render in saved chapters. Connected provider credits apply.' };
let checks = 0, browser;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const address = `http://127.0.0.1:${server.httpServer.address().port}/studio-audit`;
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(), errors = [], calls = [], saved = new Map(), keys = new Map();
    const syntheticSecret = 'pip_media_synthetic_browser_audit_key_only_1234567890';
    let finishRender = false, disconnected = false, failCreateOnce = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== API) return route.continue();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      check(req.headers()['x-office-token'] === token && !url.href.includes(token), 'Office credentials remain in authenticated headers');
      const body = req.postData() ? req.postDataJSON() : null;
      calls.push({ path: url.pathname, method: req.method(), body });
      if (url.pathname === '/office/ai/studio/keys') {
        if (req.method() === 'POST') {
          const key = { id: crypto.randomUUID(), name: body.name, prefix: 'pip_media_fixture', createdAt: new Date().toISOString(), scopes: ['photos:generate', 'videos:generate', 'content:generate'], dailyGenerationLimit: 100, userDailyGenerationLimit: 10 };
          keys.set(key.id, key); return route.fulfill({ status: 201, headers, json: { key, secret: syntheticSecret } });
        }
        return route.fulfill({ headers, json: { keys: [...keys.values()] } });
      }
      if (url.pathname.startsWith('/office/ai/studio/keys/') && req.method() === 'DELETE') {
        const key = keys.get(url.pathname.split('/').at(-1)); key.revokedAt = new Date().toISOString();
        return route.fulfill({ headers, json: { key } });
      }
      if (url.pathname === '/office/ai/studio') return route.fulfill({ headers, json: { capabilities: disconnected ? { ...capabilities, photo: false, video: false, movie: false } : capabilities, projects: [...saved.values()] } });
      if (url.pathname === '/office/ai/studio/projects') {
        let project = [...saved.values()].find(item => item.clientRequestId === body.clientRequestId);
        if (!project) { project = { ...body, id: crypto.randomUUID(), status: 'draft', completedSeconds: 0, remainingSeconds: body.durationSeconds, chapters: [], artifacts: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; saved.set(project.id, project); }
        if (failCreateOnce) { failCreateOnce = false; return route.abort('connectionfailed'); }
        return route.fulfill({ status: 201, headers, json: { project } });
      }
      const match = url.pathname.match(/^\/office\/ai\/studio\/projects\/([^/]+)(?:\/(generate|cancel|resume|export|assemble|extend|regenerate))?$/);
      if (match) {
        let project = saved.get(match[1]);
        if (!project) return route.fulfill({ status: 404, headers, json: { error: 'Project unavailable.' } });
        if (match[2] === 'export') return route.fulfill({ headers, json: { project, chapters: project.chapters } });
        if (match[2] === 'generate') project = { ...project, status: 'generating', continuous: body.continuous === true, error: null,
          ...(project.completedSeconds >= project.durationSeconds && project.chapterCount > 1 ? { assembly: { id: 'assembly-fixture', status: 'processing', complete: false, coveredChapters: 3, totalChapters: 3 } } : {}) };
        if (match[2] === 'cancel') project = { ...project, status: 'cancelled', continuous: false };
        if (match[2] === 'resume') project = { ...project, status: 'draft', continuous: false };
        if (match[2] === 'extend') project = { ...project, durationSeconds: body.durationSeconds, remainingSeconds: body.durationSeconds - project.completedSeconds, status: 'draft', continuous: false, assembly: { ...project.assembly, complete: false } };
        if (match[2] === 'regenerate') project = { ...project, status: 'generating', continuous: false, replacement: body.chapterId };
        if (match[2] === 'assemble') project = { ...project, status: 'generating', assembly: { id: 'assembly-fixture', status: 'processing', complete: false, coveredChapters: 3, totalChapters: 3 } };
        if (!match[2] && finishRender && project.status === 'generating' && project.replacement) {
          const original = project.chapters.find(chapter => chapter.id === project.replacement);
          const replacement = { ...original, id: `${original.id}-v2`, mediaUrl: `https://media.invalid/chapter-${original.index + 1}-v2.mp4` };
          project = { ...project, status: 'ready', replacement: null, assembly: undefined,
            chapters: project.chapters.map(chapter => chapter.id === original.id ? replacement : chapter),
            artifacts: [...project.artifacts.filter(artifact => artifact.filename !== `chapter-${original.index + 1}.mp4` && artifact.filename !== 'assembled.mp4'), { id: replacement.id, kind: 'video', filename: `chapter-${original.index + 1}-v2.mp4`, url: replacement.mediaUrl, durationSeconds: 120 }] };
        } else if (!match[2] && finishRender && project.status === 'generating' && project.assembly) {
          project = { ...project, status: 'ready', continuous: false, completedSeconds: project.durationSeconds, remainingSeconds: 0, assembly: { ...project.assembly, status: 'completed', complete: true, url: 'https://media.invalid/assembled.mp4' }, artifacts: [...project.artifacts.filter(artifact => artifact.id !== 'assembled'), { id: 'assembled', kind: 'video', url: 'https://media.invalid/assembled.mp4', filename: 'assembled.mp4', durationSeconds: project.durationSeconds }] };
        } else if (!match[2] && finishRender && project.status === 'generating') {
          project = project.kind === 'photo' ? { ...project, status: 'ready', artifacts: [{ id: 'photo-fixture', kind: 'image', url: 'https://media.invalid/photo.png', filename: 'sunrise.png' }] }
            : { ...project, status: 'ready', completedSeconds: project.durationSeconds, remainingSeconds: 0, chapterCount: 3, nextChapterOffset: 2, chapters: [1, 2].map(index => ({ id: `chapter-${index}`, index: index - 1, status: 'completed', mediaUrl: `https://media.invalid/chapter-${index}.mp4`, durationSeconds: 120 })), artifacts: [1, 2].map(index => ({ id: `artifact-${index}`, kind: 'video', filename: `chapter-${index}.mp4`, url: `https://media.invalid/chapter-${index}.mp4`, durationSeconds: 120 })) };
        }
        if (url.searchParams.get('after') === '2') return route.fulfill({ headers, json: { project: { ...project, nextChapterOffset: null, chapters: [{ id: 'chapter-3', index: 2, status: 'completed', mediaUrl: 'https://media.invalid/chapter-3.mp4', durationSeconds: 120 }], artifacts: [{ id: 'artifact-3', kind: 'video', filename: 'chapter-3.mp4', url: 'https://media.invalid/chapter-3.mp4', durationSeconds: 120 }] } } });
        saved.set(project.id, project);
        if (project.lateFixture) {
          const after = Number(url.searchParams.get('after') || 0), found = project.chapters.filter(chapter => chapter.index >= after);
          const pageChapters = found.slice(0, 100);
          if (project.replacement) { const old = project.chapters.find(chapter => chapter.id === project.replacement); pageChapters.push({ ...old, id: `${old.id}-pending`, status: 'dispatching', mediaUrl: undefined }); }
          const ids = new Set(pageChapters.map(chapter => chapter.id));
          return route.fulfill({ headers, json: { project: { ...project, nextChapterOffset: found.length > 100 ? after + 100 : null, chapters: pageChapters, artifacts: project.artifacts.filter(artifact => ids.has(artifact.id)) } } });
        }
        return route.fulfill({ headers, json: { project } });
      }
      if (url.pathname === '/office/ai') return route.fulfill({ headers, json: { provider: 'Cloudflare', configured: true, model: '@cf/test/model', researchAvailable: true, tonesAvailable: true } });
      if (url.pathname === '/office/ai/chat') return route.fulfill({ headers, json: { reply: 'An imaginative answer with stated assumptions.', generatedAt: new Date().toISOString(), research: { status: 'off' }, sources: [] } });
      if (url.pathname === '/office/ai/tasks') return route.fulfill({ headers, json: { tasks: [], capabilities: { editCode: true, publish: true, deploy: true, operate: true, tonesAvailable: true, deployTargets: [] } } });
      if (url.pathname === '/office/ai/conversations') return route.fulfill({ headers, json: req.method() === 'GET' ? { conversations: [], storage: 'encrypted-database' } : { conversation: { ...body, id: body.clientRequestId, version: 1, updatedAt: new Date().toISOString() } } });
      if (url.pathname.startsWith('/office/ai/conversations/')) return route.fulfill({ headers, json: { conversation: { ...body, id: url.pathname.split('/').at(-1), version: (body?.expectedVersion || 1) + 1, updatedAt: new Date().toISOString() } } });
      if (url.pathname === '/office/ai/tools') return route.fulfill({ headers, json: { tools: [] } });
      if (url.pathname === '/office/controls') return route.fulfill({ headers, json: { controls: [] } });
      if (url.pathname === '/office/connections') return route.fulfill({ headers, json: { connections: [] } });
      return route.fulfill({ headers, json: {} });
    });
    await page.goto(address);
    await page.getByRole('button', { name: 'Movie A film in chapters', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).fill('The Lantern Keepers');
    await page.getByLabel('What is your story?', { exact: true }).fill('An original animated fox protects the last lighthouse in a floating city.');
    await page.getByLabel('Requested runtime', { exact: true }).fill('2');
    await page.getByLabel('Runtime unit', { exact: true }).selectOption('hours');
    await page.getByLabel('Studio creative freedom', { exact: true }).selectOption('creative');
    await page.getByLabel('Producer’s brief', { exact: true }).fill('Warm cinematic fantasy for families, slow opening, hopeful ending.');
    await page.getByText('Your cast', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Add character', exact: true }).click();
    await page.getByLabel('Character name', { exact: true }).fill('Luma');
    await page.getByLabel('Appearance', { exact: true }).fill('A copper fox with a teal scarf and a star-shaped lantern.');
    await page.getByLabel('Personality', { exact: true }).fill('Curious, brave, careful with strangers.');
    await page.getByLabel('Voice', { exact: true }).fill('Warm, calm, measured delivery.');
    check(!calls.some(item => item.path.endsWith('/generate')), 'Editing a production brief never starts paid generation');
    failCreateOnce = true;
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'connection ended' }).waitFor();
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('heading', { name: 'The Lantern Keepers', exact: true }).waitFor();
    const creates = calls.filter(item => item.path.endsWith('/projects') && item.method === 'POST');
    check(creates.at(-1).body.clientRequestId === creates.at(-2).body.clientRequestId && saved.size === 1, 'Retry after a lost creation receipt recovers the same project');
    const body = creates.at(-1).body;
    check(body.durationSeconds === 7200 && body.creativity === 'creative', 'Custom two-hour duration and creative freedom are sent intact');
    check(body.producer.brief.includes('hopeful ending') && body.producer.roles.includes('Continuity editor') && body.characters[0].name === 'Luma' && body.characters[0].voice.includes('measured'), 'Producer direction and complete character bible accompany the project');
    check(!calls.some(item => item.path.endsWith('/generate')), 'Creating a project saves a plan without rendering');
    await page.getByRole('button', { name: 'Generate full movie', exact: true }).click();
    await page.getByText('Generating and joining clips automatically', { exact: false }).waitFor();
    check(calls.filter(item => item.path.endsWith('/generate')).length === 1 && calls.findLast(item => item.path.endsWith('/generate')).body.continuous === true, 'Full movie generation explicitly authorizes successive clips beyond two minutes');
    saved.set([...saved.keys()][0], { ...[...saved.values()][0], status: 'ready', continuous: true });
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    check(await page.getByRole('button', { name: 'Stop project', exact: true }).isEnabled(), 'Queued continuous work can be stopped between rendering and assembly stages');
    await page.getByRole('button', { name: 'Stop project', exact: true }).click();
    await page.getByRole('button', { name: 'Resume project', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume project', exact: true }).click();
    await page.getByRole('button', { name: 'Generate full movie', exact: true }).waitFor();
    check(calls.filter(item => item.path.endsWith('/generate')).length === 1, 'Resuming a project does not restart paid generation');
    await page.getByRole('button', { name: 'Generate one chapter', exact: true }).click();
    check(Object.keys(calls.findLast(item => item.path.endsWith('/generate')).body).length === 0, 'Single chapter generation remains available without enabling continuous work');
    finishRender = true;
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.getByLabel('Play chapters continuously', { exact: true }).waitFor();
    const movie = page.getByLabel('Movie playback').locator('video');
    check((await movie.getAttribute('src')).includes('chapter-1'), 'Completed production starts playback at the first chapter');
    await movie.evaluate(element => element.dispatchEvent(new Event('ended')));
    await page.waitForFunction(() => document.querySelector('.studio-player video')?.src.includes('chapter-2'));
    check(true, 'Continuous playback advances to the next saved chapter');
    await page.getByRole('button', { name: 'Load more chapters', exact: true }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    check((await movie.getAttribute('src')).includes('chapter-3'), 'Paginated chapters append to the continuous film player');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export production plan', exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    check(exported.project.characters[0].name === 'Luma' && exported.project.durationSeconds === 7200, 'Export retains requested runtime, cast, and generated chapter receipts');
    check(await page.getByRole('link').filter({ hasText: 'chapter-1.mp4' }).count() === 1, 'Completed media has an actual artifact link');
    await page.getByRole('button', { name: 'Assemble full movie', exact: true }).click();
    check(calls.findLast(item => item.path.endsWith('/generate')).body.continuous === true, 'Assembly explicitly continues every remaining joining stage');
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.getByText('Full movie', { exact: true }).waitFor();
    check((await movie.getAttribute('src')).includes('assembled.mp4') && await page.getByRole('link').filter({ hasText: 'assembled.mp4' }).count() === 1, 'Assembly returns a single MP4 for full-movie playback and download');
    const beforeExtendCalls = calls.filter(item => item.path.endsWith('/generate')).length;
    await page.getByLabel('New total runtime', { exact: true }).fill('2.5');
    await page.getByLabel('Extended runtime unit', { exact: true }).selectOption('hours');
    await page.getByRole('button', { name: 'Extend runtime', exact: true }).click();
    await page.getByText('Runtime extended.', { exact: false }).waitFor();
    check(calls.findLast(item => item.path.endsWith('/extend')).body.durationSeconds === 9000 && calls.filter(item => item.path.endsWith('/generate')).length === beforeExtendCalls, 'Extending an existing movie saves its new total runtime without starting generation');
    await page.getByRole('button', { name: 'Generate full movie', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.getByText('Full movie', { exact: true }).waitFor();
    check(calls.findLast(item => item.path.endsWith('/generate')).body.continuous === true, 'The extended film continues and joins clips using full generation');
    finishRender = false;
    await page.getByText('Chapter progress', { exact: false }).click();
    await page.getByRole('button', { name: 'Regenerate chapter 2', exact: true }).click();
    check(calls.findLast(item => item.path.endsWith('/regenerate')).body.chapterId === 'chapter-2', 'Regeneration addresses the chosen saved clip');
    check([...saved.values()][0].chapters.find(chapter => chapter.id === 'chapter-2')?.mediaUrl === 'https://media.invalid/chapter-2.mp4', 'Original footage stays available while its replacement renders');
    finishRender = true;
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'chapter-2-v2.mp4' }).waitFor();
    check(!(await movie.getAttribute('src')).includes('assembled.mp4') && ![...saved.values()][0].assembly && [...saved.values()][0].durationSeconds === 9000, 'Replacing a clip preserves runtime and invalidates the earlier joined movie');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Studio fits ${width}px without page overflow`);
    await page.screenshot({ path: path.join(output, `office-ai-studio-${width}.png`), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: /The Lantern Keepers/ }).click();
    await page.getByRole('heading', { name: 'The Lantern Keepers', exact: true }).waitFor();
    check(await page.getByText('Luma', { exact: true }).count() === 1, 'Reloading recovers the saved project and cast');
    const lateChapters = Array.from({ length: 151 }, (_, index) => ({ id: `late-chapter-${index + 1}`, index, status: 'completed', durationSeconds: 120, mediaUrl: `https://media.invalid/chapter-${index + 1}.mp4` }));
    const lateProject = { ...[...saved.values()][0], id: crypto.randomUUID(), title: 'A movie with 151 clips', durationSeconds: 151 * 120, completedSeconds: 151 * 120, remainingSeconds: 0, chapterCount: 151, continuous: false, status: 'ready', assembly: undefined, lateFixture: true,
      chapters: lateChapters, artifacts: lateChapters.map(chapter => ({ id: chapter.id, kind: 'video', filename: `chapter-${chapter.index + 1}.mp4`, url: chapter.mediaUrl, durationSeconds: 120 })) };
    saved.set(lateProject.id, lateProject);
    await page.getByRole('button', { name: 'Refresh Studio', exact: true }).click();
    await page.getByRole('button', { name: /A movie with 151 clips/ }).click();
    await page.getByRole('button', { name: 'Load more chapters', exact: true }).click();
    await page.getByText('Chapter progress', { exact: false }).click();
    finishRender = false;
    await page.getByRole('button', { name: 'Regenerate chapter 151', exact: true }).click();
    check(saved.get(lateProject.id).chapters.at(-1).id === 'late-chapter-151', 'A late chapter keeps its original footage during regeneration');
    finishRender = true;
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'chapter-151-v2.mp4' }).waitFor();
    await page.getByRole('button', { name: '151', exact: true }).click();
    check((await page.getByLabel('Movie playback').locator('video').getAttribute('src')).includes('chapter-151-v2.mp4'), 'Completed late-clip regeneration refreshes its page and retains all 151 loaded playback clips');
    check(calls.some(call => call.path.endsWith(lateProject.id) && call.method === 'GET') && await page.getByRole('button', { name: 'Regenerate chapter 151', exact: true }).count() === 1, 'Late regeneration leaves one canonical clip and no stale dispatch receipt');
    await page.getByRole('button', { name: 'Photo A single image', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).fill('A quiet sunrise');
    await page.getByLabel('Describe your photo', { exact: true }).fill('A soft cinematic sunrise over an empty harbor.');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('button', { name: 'Generate photo', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
    await page.locator('.studio-photo img').waitFor();
    check((await page.locator('.studio-photo img').getAttribute('src')).startsWith('https://'), 'Photo generation renders the returned image artifact');
    disconnected = true;
    await page.getByRole('button', { name: 'Refresh Studio', exact: true }).click();
    await page.getByText('This project is saved.', { exact: false }).waitFor();
    check(await page.locator('.studio-readiness [data-ready=false]').count() === 3, 'Missing providers appear as disconnected without inventing generated results');
    await page.getByRole('navigation', { name: 'Studio sections', exact: true }).getByRole('button', { name: 'API keys', exact: true }).click();
    await page.getByLabel('Key name', { exact: true }).fill('Render production');
    await page.getByRole('button', { name: 'Generate API key', exact: true }).click();
    const secret = page.getByLabel('New Pip media API key', { exact: true });
    await secret.waitFor();
    check(await secret.inputValue() === syntheticSecret && await secret.getAttribute('type') === 'password', 'A new key is returned once in a masked field');
    await page.getByRole('button', { name: 'Show new API key', exact: true }).click();
    check(await secret.getAttribute('type') === 'text', 'The operator can reveal and copy the one-time key');
    await page.getByRole('button', { name: 'Copy key', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Copied') || document.body.textContent.includes('Select the key and copy it, then save it in Render.'));
    check(await page.getByRole('button', { name: 'Copied', exact: true }).count() === 1 || await page.getByText('Select the key and copy it, then save it in Render.', { exact: true }).count() === 1, 'Copy reports success or offers a manual selection fallback');
    check(!(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes(syntheticSecret), 'API secrets never enter browser storage');
    check(await page.getByText('Photos', { exact: true }).count() === 1 && await page.getByText('Videos', { exact: true }).count() === 1 && await page.getByText('AI content', { exact: true }).count() === 1, 'Keys list only the fixed photo, video, and existing AI content scopes');
    await page.getByText('Server integration example', { exact: true }).click();
    check((await page.locator('.studio-render-guide pre').innerText()).includes('process.env.PIP_STUDIO_API_KEY') && (await page.locator('.studio-render-guide pre').innerText()).includes('x-pip-user-id'), 'Render integration uses a server environment key and authenticated end-user identity');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `API key management fits ${width}px without page overflow`);
    await page.getByRole('navigation', { name: 'Studio sections', exact: true }).getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('navigation', { name: 'Studio sections', exact: true }).getByRole('button', { name: 'API keys', exact: true }).click();
    check(await page.getByLabel('New Pip media API key', { exact: true }).count() === 0 && !(await page.locator('.studio-key-list').innerText()).includes(syntheticSecret), 'Leaving the API key tab clears the one-time secret; list reads return metadata only');
    await page.screenshot({ path: path.join(output, `office-ai-studio-keys-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Revoke key Render production', exact: true }).click();
    await page.getByText('Render production revoked.', { exact: false }).waitFor();
    check(await page.getByRole('button', { name: 'Revoke key Render production', exact: true }).count() === 0, 'Revocation disables the listed key and reports its effect');
    await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
    await page.getByLabel('Project title', { exact: true }).waitFor();
    check(await page.getByLabel('Project title', { exact: true }).inputValue() === '', 'Changing Office access clears unsaved Studio drafts and selected project');
    check(!errors.length, `No browser errors at ${width}px: ${errors.join('; ')}`);
    if (width === 1440) {
      disconnected = false;
      await page.goto(address + '?full');
      await page.getByRole('navigation', { name: 'Pip main navigation', exact: true }).getByRole('button', { name: 'Studio', exact: true }).waitFor();
      check(await page.getByRole('button', { name: /Create a photo or movie/ }).isVisible(), 'Conversation starters expose media generation');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('button', { name: 'Settings & history', exact: true }).click();
      await page.getByLabel('Conversation creative freedom', { exact: true }).selectOption('creative');
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
      await page.getByLabel('Message Pip', { exact: true }).fill('Write a poem about moonlit gardens.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('An imaginative answer with stated assumptions.', { exact: true }).waitFor();
      check(calls.findLast(item => item.path === '/office/ai/chat').body.creativity === 'creative', 'Conversation sends the chosen creative freedom to its backend');
      await page.getByLabel('Message Pip', { exact: true }).fill('Create a photo of a blue lantern in the snow.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByLabel('Describe your photo', { exact: true }).waitFor();
      check((await page.getByLabel('Describe your photo', { exact: true }).inputValue()).includes('blue lantern'), 'A typed photo request opens Studio with its prompt ready to review');
      check(await page.getByRole('button', { name: 'Create project', exact: true }).isVisible(), 'Media intent still requires explicit project and generation actions');
    }
    await context.close();
  }
  console.log(`PASS: Office AI Studio browser audit (${checks} checks; desktop, 390px, 320px).`);
} finally { await browser?.close(); await server.close(); await fs.rm(fixturePath, { force: true }); }
