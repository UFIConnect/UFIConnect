import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root, configFile: path.join(root, 'vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5173, strictPort: false,
    proxy: { '/api': { target: 'https://api.uficonnect.org', changeOrigin: true, rewrite: value => value.replace(/^\/api/, '') } } },
});
await server.listen();
server.printUrls();
