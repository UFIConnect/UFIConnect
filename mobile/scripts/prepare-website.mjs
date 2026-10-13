import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(mobileRoot, '../web/public');
const destination = path.join(mobileRoot, 'public');
await mkdir(destination, { recursive: true });
let count = 0;
let bytes = 0;
async function copyAssets(directory, relative = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) {
      if (!relative && !['brand', 'media'].includes(item.name)) continue;
      await copyAssets(path.join(directory, item.name), name);
    } else if (/\.(?:svg|png|jpe?g|webp|ico|woff2?|mp4|vtt)$/i.test(item.name)) {
      const target = path.join(destination, name);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(directory, item.name), target);
      count += 1; bytes += (await stat(target)).size;
    }
  }
}
await copyAssets(source);
// PWA/service workers and desktop installers belong to the website. The native
// assets are regenerated from the current shared source on every build.
await writeFile(path.join(destination, '.website-assets.json'), JSON.stringify({ source: '../web/public', count, bytes }, null, 2) + '\n');
console.log(`Prepared ${count} current website assets (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
