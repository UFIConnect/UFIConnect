import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createOfficeServer } from '../office/node_modules/vite/dist/node/index.js';
import { createServer as createWebServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const servers = [];
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.allSettled(servers.map(server => server.close()));
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { close().finally(() => { process.exitCode = 0; }); });
}

try {
  const webRoot = path.join(root, 'web');
  const web = await createWebServer({
    root: webRoot,
    configFile: path.join(webRoot, 'vite.config.js'),
    envFile: false,
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify(''),
    },
    server: {
      host: '127.0.0.1', port: 4173, strictPort: true,
      proxy: {
        '/api': {
          target: 'https://api.uficonnect.org', changeOrigin: true,
          rewrite: value => value.replace(/^\/api/, ''),
        },
      },
    },
  });
  servers.push(web);
  const officeRoot = path.join(root, 'office');
  const office = await createOfficeServer({
    root: officeRoot,
    configFile: path.join(officeRoot, 'vite.config.js'),
    mode: 'release-local',
    server: { host: '127.0.0.1', port: 4174, strictPort: true },
  });
  servers.push(office);
  await web.listen();
  await office.listen();
  console.log('Local Office: http://127.0.0.1:4174');
  console.log('Local website: http://127.0.0.1:4173');
  console.log('Use the Local web tab to edit and preview website files before publishing.');
} catch (error) {
  await close();
  console.error(`Could not start the local release workspace: ${error.message}`);
  process.exitCode = 1;
}
