import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createOfficeServer } from '../office/node_modules/vite/dist/node/index.js';
import { createServer as createWebServer } from '../web/node_modules/vite/dist/node/index.js';
import { createGithubReview } from './local-github-review.mjs';
import { createPhoneAccess } from './local-phone-access.mjs';
import { localWebWorkbench } from './local-web-workbench.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const servers = [];
const phoneAccess = createPhoneAccess({ root });
// Both website previews (your files on 4173, the GitHub version on 4175) use the same settings.
const webConfig = () => ({
  envDir: false,
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify(''),
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://api.uficonnect.org', changeOrigin: true,
        rewrite: value => value.replace(/^\/api/, ''),
      },
    },
  },
});
const githubReview = createGithubReview({ root, webConfig });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await phoneAccess.stop();
  await githubReview.stop();
  await Promise.allSettled(servers.map(server => server.close()));
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { close().finally(() => { process.exitCode = 0; }); });
}

try {
  const webRoot = path.join(root, 'web');
  const config = webConfig();
  const web = await createWebServer({
    ...config,
    root: webRoot,
    configFile: path.join(webRoot, 'vite.config.js'),
    server: { ...config.server, host: '127.0.0.1', port: 4173, strictPort: true },
  });
  servers.push(web);
  const officeRoot = path.join(root, 'office');
  const office = await createOfficeServer({
    root: officeRoot,
    configFile: path.join(officeRoot, 'vite.config.js'),
    mode: 'release-local',
    plugins: [localWebWorkbench({ mode: 'release-local', phoneAccess, githubReview })],
    server: { host: '127.0.0.1', port: 4174, strictPort: true },
  });
  servers.push(office);
  await web.listen();
  await office.listen();
  console.log('Local Office: http://127.0.0.1:4174');
  console.log('Local website: http://127.0.0.1:4173');
  console.log('Use the Local web tab to edit and preview website files before publishing.');
  console.log('Choose GitHub in its preview to review the latest version from GitHub without changing your files.');
  if (process.argv.includes('--phone')) {
    await phoneAccess.start();
    console.log('Phone connection ready. Its link and code are available in Local web.');
  }
} catch (error) {
  await close();
  console.error(`Could not start the local release workspace: ${error.message}`);
  process.exitCode = 1;
}
