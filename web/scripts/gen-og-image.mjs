import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create 1200x630 canvas
const canvas = createCanvas(1200, 630);
const ctx = canvas.getContext('2d');

// Background: navy to purple gradient
const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
gradient.addColorStop(0, '#1e3a8a');
gradient.addColorStop(1, '#5b21b6');
ctx.fillStyle = gradient;
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

// Main text: UFconnect
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 100px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('UFconnect', 600, 260);

// Tagline
ctx.fillStyle = 'rgba(255,255,255,0.85)';
ctx.font = 'regular 36px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
ctx.fillText('Professional Networking · No Ads', 600, 380);

// Save to file
const publicDir = path.join(__dirname, '..', 'public');
const outputPath = path.join(publicDir, 'og-image.png');

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outputPath, buffer);
console.log(`✓ OG image generated: ${outputPath}`);
