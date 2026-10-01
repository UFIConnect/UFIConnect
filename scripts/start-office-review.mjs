import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import { createVaultPreview } from './start-vault-review.mjs';
import { localWebWorkbench } from './local-web-workbench.mjs';
import { createGithubReview } from './local-github-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const officeOrigin = 'http://127.0.0.1:4174';
let preview, office;
const githubReview = createGithubReview({ root, defaultBranch: 'review/local-web',
  startPreview: ({ root: projectRoot, port }) => createVaultPreview({ projectRoot, port, samples: true, officeOrigin }),
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await githubReview.stop();
  await Promise.allSettled([office?.close(), preview?.close()]);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { close().finally(() => process.exit()); });
}
try {
  // Preserve the existing preview origin and its encrypted browser storage.
  preview = await createVaultPreview({ port: 4188, samples: true, officeOrigin });
  const officeRoot = path.join(root, 'office');
  office = await createServer({
    root: officeRoot,
    configFile: path.join(officeRoot, 'vite.config.js'),
    mode: 'release-local',
    plugins: [localWebWorkbench({ mode: 'release-local', root, previewUrl: preview.url, reviewOnly: true, githubReview })],
    server: { host: '127.0.0.1', port: 4174, strictPort: true },
  });
  await office.listen();
  console.log(`Office review: ${officeOrigin}/#local-web`);
  console.log(`Local website and Vault: ${preview.url}`);
  console.log('Office refresh fetches the latest review/local-web branch from GitHub into a separate preview.');
  console.log('Sample account and sample content. Vault stays local; public publishing and phone sharing are unavailable in this review workspace.');
} catch (error) {
  await close();
  console.error(`Could not start Office review: ${error.message}`);
  process.exitCode = 1;
}
