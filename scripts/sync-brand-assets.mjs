// Keep every first-party app icon aligned with the approved UFI logo, a rounded
// tile with transparent corners. Run after changing marketing/brand/ufi-logo.png;
// --check only compares.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = await fs.readFile(path.join(root, 'marketing/brand/ufi-logo.png'));
const checkOnly = process.argv.includes('--check');
const outputs = new Map();
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
const page = await browser.newPage();
await page.route('**/*', route => route.abort());
const rasterCache = new Map();

function compressPng(data) {
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    chunks.push({ type: data.toString('ascii', offset + 4, offset + 8), bytes: data.subarray(offset, offset + length + 12) });
    offset += length + 12;
  }
  const compressed = deflateSync(inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.bytes.subarray(8, -4)))), { level: 9 });
  const idat = Buffer.alloc(compressed.length + 12);
  idat.writeUInt32BE(compressed.length); idat.write('IDAT', 4); compressed.copy(idat, 8);
  idat.writeUInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
  let inserted = false;
  return Buffer.concat([data.subarray(0, 8), ...chunks.flatMap(chunk => {
    if (chunk.type !== 'IDAT') return [chunk.bytes];
    if (inserted) return [];
    inserted = true; return [idat];
  })]);
}

// App icons fill the logo's transparent corners with navy so platform masks
// never show a light edge; type 'image/webp' keeps them transparent instead.
async function raster(size, scale = 1, type = 'image/png') {
  const key = `${size}:${scale}:${type}`;
  if (rasterCache.has(key)) return rasterCache.get(key);
  const encoded = await page.evaluate(async ({ source, size, scale, type }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (type === 'image/png') {
      context.fillStyle = '#102A6B';
      context.fillRect(0, 0, size, size);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const inset = size * (1 - scale) / 2;
    context.drawImage(image, inset, inset, size * scale, size * scale);
    return canvas.toDataURL(type, .88).split(',')[1];
  }, { source: `data:image/png;base64,${original.toString('base64')}`, size, scale, type });
  const data = type === 'image/png' ? compressPng(Buffer.from(encoded, 'base64')) : Buffer.from(encoded, 'base64');
  rasterCache.set(key, data);
  return data;
}

// PNG images inside ICO keep all sizes crisp without changing the artwork.
async function ico(sizes) {
  const images = [];
  for (const size of sizes) images.push(await raster(size));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  return Buffer.concat([header, ...images]);
}

// SVG icons (favicon, manifest "any" icon and in-app marks) wrap a compact
// 512px copy of the logo that stays sharp at every size they are shown.
const vector = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <title>UFIconnect</title>
  <image width="512" height="512" xlink:href="data:image/webp;base64,${(await raster(512, 1, 'image/webp')).toString('base64')}"/>
</svg>
`);
for (const file of ['web/public/icon.svg', 'web/public/favicon.svg', 'web/public/uficonnect-google-verification-icon.svg', 'web/public/uficonnect-mark.svg', 'web/public/uficonnect-oauth-logo.svg', 'office/public/icon.svg']) outputs.set(file, vector);
// Keep the existing wordmark layout while using the same approved artwork.
outputs.set('web/public/uficonnect-wordmark.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 320 64" role="img" aria-label="UFIConnect">
  <image width="64" height="64" xlink:href="data:image/webp;base64,${(await raster(512, 1, 'image/webp')).toString('base64')}"/>
  <text x="81" y="43" font-family="Arial,Helvetica,sans-serif" font-size="37" font-weight="700" fill="#102a6b">UFIConnect</text>
</svg>
`));
for (const [file, size, scale] of [
  ['web/public/uficonnect-google-verification-icon.png', 512, 1],
  ['web/public/icon-192.png', 192, 1], ['web/public/icon-512.png', 512, 1],
  ['web/public/icon-maskable-512.png', 512, .7],
  ['mobile/assets/icon.png', 1024, 1], ['mobile/assets/adaptive-icon.png', 1024, .62],
  ['mobile/assets/splash.png', 1024, 1], ['mobile/assets/favicon.png', 48, 1],
]) outputs.set(file, await raster(size, scale));
for (const [alias, source] of [
  ['uficonnect-oauth-logo.png', 'uficonnect-google-verification-icon.png'],
  ['uficonnect-icon-192.png', 'icon-192.png'],
  ['uficonnect-icon-512.png', 'icon-512.png'],
  ['uficonnect-icon-maskable-512.png', 'icon-maskable-512.png'],
]) outputs.set('web/public/' + alias, outputs.get('web/public/' + source));
outputs.set('web/public/favicon.ico', await ico([16, 32, 48, 256]));

// Preserve each existing native resource's density/dimensions. Adaptive artwork
// is padded so Android's launcher masks do not clip the UFI lettering.
for (const dir of await fs.readdir(path.join(root, 'android-twa/app/src/main/res'))) {
  if (!/^mipmap-(?:mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)$/.test(dir)) continue;
  for (const name of ['ic_launcher.png', 'ic_maskable.png']) {
    const file = `android-twa/app/src/main/res/${dir}/${name}`;
    const existing = await fs.readFile(path.join(root, file));
    const size = existing.readUInt32BE(16);
    if (size < 16 || size > 2048 || size !== existing.readUInt32BE(20)) throw Error(`Unexpected icon dimensions: ${file}`);
    outputs.set(file, await raster(size, name === 'ic_maskable.png' ? .7 : 1));
  }
}

const mismatches = [];
for (const [file, data] of outputs) {
  const target = path.join(root, file);
  if (checkOnly) {
    const existing = await fs.readFile(target).catch(() => null);
    if (!existing?.equals(data)) mismatches.push(file);
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
}
if (mismatches.length) throw Error(`Brand assets differ from the approved original: ${mismatches.join(', ')}`);
console.log(`${checkOnly ? 'Verified' : 'Updated'} ${outputs.size} UFI brand assets from the approved original.`);
} finally { await browser.close(); }
