import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PREPARATION_VIDEOS } from '../src/data/preparationVideos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../public/media/preparation');
const provenanceDir = path.resolve(__dirname, '../../docs/media/preparation-videos');
const width = 960;
const height = 540;
const frameRate = 24;
const slideSeconds = 5.2;
const transitionSeconds = 0.45;
const fontStack = 'Segoe UI, Arial, sans-serif';

const colors = {
  navy: '#102A6B',
  ink: '#0A1633',
  pale: '#F3F6FB',
  white: '#FFFFFF',
  cyan: '#63C7E8',
  green: '#55C78A',
  line: '#CAD5E7',
  muted: '#66758E',
};

function findRecursively(root, filename, depth = 5) {
  if (!root || !existsSync(root) || depth < 0) return '';
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const found = findRecursively(candidate, filename, depth - 1);
      if (found) return found;
    }
  }
  return '';
}

function executableCandidates(filename) {
  const candidates = [process.env.FFMPEG_PATH, filename];
  if (process.platform === 'win32') {
    candidates.push(findRecursively(
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'),
      `${filename}.exe`,
    ));
  } else {
    candidates.push(`/usr/bin/${filename}`, `/usr/local/bin/${filename}`, `/opt/homebrew/bin/${filename}`);
  }
  return candidates.filter(Boolean);
}

function resolveExecutable(filename) {
  for (const candidate of executableCandidates(filename)) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error(`${filename} was not found. Install FFmpeg or set FFMPEG_PATH.`);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wordUnits(value) {
  return [...String(value)].reduce((total, character) => {
    if ('MW@%'.includes(character)) return total + 1.45;
    if ('ilI.,:;!|'.includes(character)) return total + 0.45;
    return total + 1;
  }, 0);
}

function wrapLines(text, maxUnits, maxLines = 4) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let consumed = 0;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && wordUnits(next) > maxUnits) {
      lines.push(current);
      consumed += current.split(/\s+/).length;
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    consumed += current.split(/\s+/).length;
  }
  if (consumed < words.length) {
    let last = lines.at(-1) || '';
    while (last && wordUnits(`${last}...`) > maxUnits) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
}

function textBlock(lines, x, y, lineHeight, attributes = '') {
  return `<text x="${x}" y="${y}" ${attributes}>${lines.map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
  )).join('')}</text>`;
}

function svgDocument(content) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>text { font-family: ${fontStack}; letter-spacing: 0; }</style>`,
    content,
    '</svg>',
    '',
  ].join('\n');
}

function brandMarkup(inverse = false) {
  const box = inverse ? colors.white : colors.navy;
  const initials = inverse ? colors.navy : colors.white;
  const label = inverse ? colors.white : colors.ink;
  return [
    `<rect x="48" y="38" width="54" height="54" rx="10" fill="${box}"/>`,
    `<text x="75" y="73" fill="${initials}" font-size="20" font-weight="700" text-anchor="middle">UFI</text>`,
    `<text x="118" y="73" fill="${label}" font-size="20" font-weight="700">Career Studio</text>`,
  ].join('\n');
}

function lessonBrandMarkup() {
  return [
    `<rect x="34" y="34" width="54" height="54" rx="10" fill="${colors.white}"/>`,
    `<text x="61" y="69" fill="${colors.navy}" font-size="20" font-weight="700" text-anchor="middle">UFI</text>`,
    `<text x="34" y="115" fill="${colors.white}" font-size="13" font-weight="700">CAREER STUDIO</text>`,
  ].join('\n');
}

function titleFrame(video) {
  const titleLines = wrapLines(video.title, 24, 3);
  const summaryLines = wrapLines(video.summary, 55, 3);
  return svgDocument([
    `<rect width="${width}" height="${height}" fill="${colors.navy}"/>`,
    `<rect x="700" width="260" height="${height}" fill="${colors.ink}"/>`,
    `<rect x="700" width="14" height="350" fill="${colors.cyan}"/>`,
    `<rect x="700" y="350" width="14" height="190" fill="${colors.green}"/>`,
    brandMarkup(true),
    `<text x="48" y="160" fill="${colors.cyan}" font-size="18" font-weight="700">${escapeXml(video.topic.toUpperCase())}</text>`,
    textBlock(titleLines, 48, 218, 58, `fill="${colors.white}" font-size="49" font-weight="700"`),
    textBlock(summaryLines, 48, 395, 31, 'fill="#D9E4FA" font-size="22" font-weight="400"'),
    `<text x="752" y="87" fill="${colors.white}" font-size="15" font-weight="700">ORIGINAL LESSON</text>`,
    `<text x="752" y="118" fill="#AFC2E8" font-size="15">${video.slides.length} practical steps</text>`,
    `<text x="752" y="143" fill="#AFC2E8" font-size="15">${video.duration}</text>`,
    `<circle cx="830" cy="302" r="45" fill="${colors.white}" fill-opacity="0.12"/>`,
    `<path d="M818 279 L818 325 L852 302 Z" fill="${colors.white}"/>`,
  ].join('\n'));
}

function lessonFrame(video, slide, slideIndex) {
  const titleLines = wrapLines(slide.title, 27, 2);
  const bodyLines = wrapLines(slide.body, 45, 4);
  const accent = slideIndex % 2 === 0 ? colors.cyan : colors.green;
  const progress = Math.round(644 * ((slideIndex + 1) / video.slides.length));
  return svgDocument([
    `<rect width="${width}" height="${height}" fill="${colors.pale}"/>`,
    `<rect width="190" height="${height}" fill="${colors.navy}"/>`,
    `<rect width="12" height="${height}" fill="${accent}"/>`,
    lessonBrandMarkup(),
    `<text x="34" y="185" fill="${colors.white}" font-size="16" font-weight="700">${escapeXml(video.topic.toUpperCase())}</text>`,
    `<text x="34" y="270" fill="${colors.white}" font-size="64" font-weight="700">${String(slideIndex + 1).padStart(2, '0')}</text>`,
    `<text x="37" y="298" fill="#C7D4EE" font-size="15">OF ${String(video.slides.length).padStart(2, '0')}</text>`,
    '<rect x="234" y="134" width="130" height="34" rx="7" fill="#DDE7F7"/>',
    `<text x="250" y="157" fill="${colors.navy}" font-size="15" font-weight="700">${escapeXml(slide.label.toUpperCase())}</text>`,
    textBlock(titleLines, 234, 228, 54, `fill="${colors.ink}" font-size="45" font-weight="700"`),
    textBlock(bodyLines, 234, 346, 39, `fill="${colors.muted}" font-size="27"`),
    `<rect x="234" y="481" width="644" height="7" fill="${colors.line}"/>`,
    `<rect x="234" y="481" width="${progress}" height="7" fill="${colors.navy}"/>`,
    `<text x="234" y="515" fill="${colors.muted}" font-size="14">${escapeXml(video.title)}</text>`,
  ].join('\n'));
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

async function rasterizeSvg(page, svgFilename, pngFilename) {
  const svg = readFileSync(svgFilename, 'utf8').replace(/^<\?xml[^>]*>\s*/i, '');
  await page.setContent([
    '<!doctype html>',
    '<html><head><style>',
    `html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: ${colors.ink}; }`,
    'svg { display: block; width: 100%; height: 100%; }',
    '</style></head><body>',
    svg,
    '</body></html>',
  ].join(''));
  await page.screenshot({
    path: pngFilename,
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
  });
}

function encodeVideo(ffmpeg, video, frames) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const frame of frames) {
    args.push('-loop', '1', '-framerate', String(frameRate), '-t', String(slideSeconds), '-i', frame);
  }

  const filters = frames.map((_, index) => `[${index}:v]fps=${frameRate},scale=${width}:${height},format=yuv420p,setsar=1[v${index}]`);
  let current = 'v0';
  for (let index = 1; index < frames.length; index += 1) {
    const output = `x${index}`;
    const offset = index * (slideSeconds - transitionSeconds);
    filters.push(`[${current}][v${index}]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset.toFixed(2)}[${output}]`);
    current = output;
  }

  const duration = (frames.length * slideSeconds) - ((frames.length - 1) * transitionSeconds);
  const output = path.join(outputDir, `${video.slug}.mp4`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${current}]`,
    '-t', duration.toFixed(2),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '24',
    '-profile:v', 'main',
    '-level', '3.1',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-metadata', `title=${video.title}`,
    '-metadata', 'artist=UFI Career Studio',
    '-metadata', 'copyright=UFIConnect',
    output,
  );
  const encoded = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  if (encoded.status !== 0) {
    throw new Error(`Could not encode ${video.slug}:\n${encoded.stderr || encoded.error?.message || 'Unknown FFmpeg error'}`);
  }
  return output;
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(provenanceDir, { recursive: true });
const ffmpeg = resolveExecutable('ffmpeg');
const workingDir = mkdtempSync(path.join(tmpdir(), 'ufi-preparation-'));
const manifest = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

try {
  for (const video of PREPARATION_VIDEOS) {
    const videoDir = path.join(workingDir, video.slug);
    mkdirSync(videoDir, { recursive: true });
    const poster = titleFrame(video);
    const titleSvg = path.join(videoDir, '00-title.svg');
    const titlePng = path.join(videoDir, '00-title.png');
    writeFileSync(titleSvg, poster, 'utf8');
    await rasterizeSvg(page, titleSvg, titlePng);
    const posterFile = path.join(outputDir, `${video.slug}.png`);
    copyFileSync(titlePng, posterFile);
    rmSync(path.join(outputDir, `${video.slug}.svg`), { force: true });
    rmSync(path.join(outputDir, `${video.slug}.vtt`), { force: true });

    const frames = [titlePng];
    for (const [index, slide] of video.slides.entries()) {
      const baseName = `${String(index + 1).padStart(2, '0')}-${video.slug}`;
      const svgFilename = path.join(videoDir, `${baseName}.svg`);
      const pngFilename = path.join(videoDir, `${baseName}.png`);
      writeFileSync(svgFilename, lessonFrame(video, slide, index), 'utf8');
      await rasterizeSvg(page, svgFilename, pngFilename);
      frames.push(pngFilename);
    }

    const videoFile = encodeVideo(ffmpeg, video, frames);
    manifest.push({
      id: video.id,
      title: video.title,
      topic: video.topic,
      file: path.basename(videoFile),
      bytes: statSync(videoFile).size,
      sha256: sha256(videoFile),
      poster: path.basename(posterFile),
      posterBytes: statSync(posterFile).size,
      posterSha256: sha256(posterFile),
      hasExternalFootage: false,
      hasExternalAudio: false,
      hasExternalBrandAssets: false,
    });
    process.stdout.write(`Generated ${path.basename(videoFile)}\n`);
  }

  rmSync(path.join(outputDir, 'manifest.json'), { force: true });
  rmSync(path.join(outputDir, 'NOTICE.txt'), { force: true });
  writeFileSync(path.join(provenanceDir, 'manifest.json'), `${JSON.stringify({
    owner: 'UFIConnect',
    studio: 'UFI Career Studio',
    generatedAt: new Date().toISOString(),
    generator: 'web/scripts/generate-preparation-videos.mjs',
    format: `${width}x${height} H.264 MP4 with PNG posters, silent, burned-in instructional text`,
    provenance: 'Original scripts and code-rendered visual design. No third-party footage, audio, logos, or thumbnails.',
    videos: manifest,
  }, null, 2)}\n`, 'utf8');

  writeFileSync(path.join(provenanceDir, 'NOTICE.md'), [
    '# UFI Career Studio Media Provenance',
    '',
    'These preparation lessons were produced in-house from the original scripts and',
    'code-rendered visual system in web/scripts/generate-preparation-videos.mjs.',
    'They contain no third-party footage, audio, logos, thumbnails, or embedded media.',
    '',
    'Copyright UFIConnect. All rights reserved.',
    '',
  ].join('\n'), 'utf8');
} finally {
  await browser.close();
  rmSync(workingDir, { recursive: true, force: true });
}
