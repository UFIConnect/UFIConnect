import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const twaRes = path.join(root, 'android-twa', 'app', 'src', 'main', 'res');

const COLOR = '#102A6B';

function drawIcon(size, { padded = false } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const radius = size * 0.1875;
  ctx.fillStyle = COLOR;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.round(size * (padded ? 0.32 : 0.39));
  ctx.font = `900 ${fontSize}px Arial, sans-serif`;
  ctx.fillText('UF', size / 2, size * 0.53);
  return canvas;
}

function write(canvas, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log('✓', outPath.replace(root, '').replace(/\\/g, '/'));
}

const launcherSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const maskableSizes = { mdpi: 82, hdpi: 123, xhdpi: 164, xxhdpi: 246, xxxhdpi: 328 };
const notifSizes    = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

for (const [density, size] of Object.entries(launcherSizes)) {
  write(drawIcon(size), path.join(twaRes, `mipmap-${density}`, 'ic_launcher.png'));
}
for (const [density, size] of Object.entries(maskableSizes)) {
  write(drawIcon(size, { padded: true }), path.join(twaRes, `mipmap-${density}`, 'ic_maskable.png'));
}
for (const [density, size] of Object.entries(notifSizes)) {
  write(drawIcon(size), path.join(twaRes, `drawable-${density}`, 'ic_notification_icon.png'));
}

console.log('Done.');
