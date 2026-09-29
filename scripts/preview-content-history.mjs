import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { HISTORY_SCHEMA, createGeneratedContentStore } = require('../backend/generated-content');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir(path.join(root, '.cache'), { recursive: true });
const pg = new PGlite(path.join(root, '.cache/content-history-preview'));
await pg.exec(HISTORY_SCHEMA);
const app = await createAppHarness({ connected: true, query: (sql, params) => /generated_content/.test(sql) ? pg.query(sql, params) : { rows: [] } });
const userId = 'local-history-preview';
app.seedUser(member(userId, { name: 'Local Preview', plan: 'pro' }));
const store = createGeneratedContentStore(app.db);
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  plugins: [{ name: 'local-preview-session', transformIndexHtml() {
    return [{ tag: 'script', children: `localStorage.setItem('pc_token',${JSON.stringify(app.token(userId))});`, injectTo: 'head' }];
  } }],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5195, strictPort: false,
    proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
await server.listen();
const base = server.resolvedUrls.local[0];
if (!(await store.list(userId, { section: 'media' })).items.length) {
  await store.create(userId, { kind: 'image', prompt: 'Saved Studio sample', output: { mediaUrl: base + 'icon-512.png', mediaType: 'image' } });
  await store.create(userId, { kind: 'video', prompt: 'Saved video sample', output: { mediaUrl: base + 'media/preparation/professional-introduction.mp4', mediaType: 'video' } });
}
console.log(`Isolated content-history preview: ${base}command-center?tab=content`);
console.log('Local PostgreSQL history, template drafting, and sample media. No production accounts or generation providers are connected.');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close(); await server.close(); await pg.close();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
