import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create 1200x630 canvas
const canvas = createCanvas(1200, 630);
const ctx = canvas.getContext('2d');

// Public brand background.
ctx.fillStyle = '#102A6B';
ctx.fillRect(0, 0, 1200, 630);

// Subtle grid pattern
ctx.strokeStyle = 'rgba(255,255,255,0.05)';
ctx.lineWidth = 1;
for (let i = 0; i <= 1200; i += 60) {
  ctx.beginPath();
  ctx.moveTo(i, 0);
  ctx.lineTo(i, 630);
  ctx.stroke();
}
for (let i = 0; i <= 630; i += 60) {
  ctx.beginPath();
  ctx.moveTo(0, i);
  ctx.lineTo(1200, i);
  ctx.stroke();
}

// Main text: UFIconnect
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 100px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('UFIconnect', 600, 260);

// Tagline
ctx.fillStyle = 'rgba(255,255,255,0.85)';
ctx.font = 'regular 36px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
ctx.fillText('Social Network + Job Discovery', 600, 380);

// Save to file
const publicDir = path.join(__dirname, '..', 'public');
const outputPath = path.join(publicDir, 'og-image.png');

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outputPath, buffer);
console.log(`✓ OG image generated: ${outputPath}`);
