import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'public', 'favicon.ico');

const COLOR = '#102A6B';

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const radius = size * 0.25;
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
  ctx.font = `900 ${Math.round(size * 0.52)}px Arial, sans-serif`;
  ctx.fillText('UF', size / 2, size * 0.56);
  return canvas.toBuffer('image/png');
}

// Modern ICO files can embed PNG data per-entry (valid since Vista) —
// avoids reimplementing BMP/DIB encoding for a favicon.
const sizes = [16, 32, 48];
const pngs = sizes.map(drawIcon);

const headerSize = 6;
const entrySize = 16;
let offset = headerSize + entrySize * sizes.length;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);       // reserved
header.writeUInt16LE(1, 2);       // type: icon
header.writeUInt16LE(sizes.length, 4);

const entries = [];
for (let i = 0; i < sizes.length; i++) {
  const size = sizes[i];
  const png = pngs[i];
  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(size === 256 ? 0 : size, 0);   // width
  entry.writeUInt8(size === 256 ? 0 : size, 1);   // height
  entry.writeUInt8(0, 2);                          // color count
  entry.writeUInt8(0, 3);                          // reserved
  entry.writeUInt16LE(1, 4);                       // planes
  entry.writeUInt16LE(32, 6);                      // bit count
  entry.writeUInt32LE(png.length, 8);              // bytes in resource
  entry.writeUInt32LE(offset, 12);                 // offset
  entries.push(entry);
  offset += png.length;
}

const ico = Buffer.concat([header, ...entries, ...pngs]);
fs.writeFileSync(outPath, ico);
console.log(`✓ ${outPath.replace(path.join(__dirname, '..', '..'), '').replace(/\\/g, '/')} (${sizes.join('/')}px, ${ico.length} bytes)`);
