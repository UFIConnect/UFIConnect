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
import { PREPARATION_NARRATION } from '../src/data/preparationNarration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../public/media/preparation');
const provenanceDir = path.resolve(__dirname, '../../docs/media/preparation-videos');
const width = 960;
const height = 540;
const frameRate = 12;
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
  const candidates = [filename === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH, filename];
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

function encodeVideo(ffmpeg, video, frames, narration) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const [index, frame] of frames.entries()) {
    args.push('-loop', '1', '-framerate', String(frameRate), '-t', String(narration[index].duration), '-i', frame, '-i', narration[index].path);
  }

  const filters = frames.flatMap((_, index) => [
    `[${index * 2}:v]fps=${frameRate},format=yuv420p,setsar=1,trim=duration=${narration[index].duration},setpts=PTS-STARTPTS[v${index}]`,
    `[${index * 2 + 1}:a]apad,atrim=duration=${narration[index].duration},asetpts=PTS-STARTPTS[a${index}]`,
  ]);
  filters.push(`${frames.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${frames.length}:v=1:a=1[video][audio]`);
  const duration = narration.reduce((total, part) => total + part.duration, 0);
  const output = path.join(outputDir, `${video.slug}.mp4`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[video]', '-map', '[audio]',
    '-t', duration.toFixed(2),
    '-c:a', 'aac', '-b:a', '96k',
    '-c:v', 'libx264',
    '-preset', 'fast', '-threads', '2',
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
const ffprobe = resolveExecutable('ffprobe');
const workingDir = mkdtempSync(path.join(tmpdir(), 'ufi-preparation-'));
const manifest = [];
const durations = {};
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

function timestamp(seconds) {
  return new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
}

function narrate(video, videoDir) {
  const texts = [`Welcome to UFI Career Studio. ${video.title}. ${video.summary} We will work through five practical steps, with examples you can adapt to your own experience.`, ...PREPARATION_NARRATION[video.id]];
  if (texts.length !== video.slides.length + 1) throw new Error(`Incomplete narration for ${video.id}`);
  const parts = texts.map((text, i) => ({ text, path: path.join(videoDir, `${i}.wav`) }));
  const file = path.join(videoDir, 'narration.json');
  writeFileSync(file, JSON.stringify(parts));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'synthesize-preparation.ps1'), '-ManifestPath', file], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'Speech synthesis failed');
  for (const part of parts) {
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', part.path], { encoding: 'utf8', windowsHide: true });
    part.speechDuration = Number(probe.stdout.trim());
    if (probe.status !== 0 || !(part.speechDuration > 0)) throw new Error(`Invalid narration for ${video.id}`);
    part.duration = Math.ceil((part.speechDuration + 0.8) * frameRate) / frameRate;
  }
  let offset = 0;
  const captions = ['WEBVTT', ''];
  for (const part of parts) {
    const words = part.text.split(/\s+/);
    for (let i = 0; i < words.length; i += 8) {
      const end = Math.min(i + 8, words.length);
      captions.push(`${timestamp(offset + part.speechDuration * i / words.length)} --> ${timestamp(offset + part.speechDuration * end / words.length)}`, words.slice(i, end).join(' '), '');
    }
    offset += part.duration;
  }
  writeFileSync(path.join(outputDir, `${video.slug}.vtt`), captions.join('\n'));
  const seconds = Math.round(offset);
  video.duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  durations[video.id] = video.duration;
  return parts;
}

try {
  for (const video of PREPARATION_VIDEOS) {
    const videoDir = path.join(workingDir, video.slug);
    mkdirSync(videoDir, { recursive: true });
    const narration = narrate(video, videoDir);
    const poster = titleFrame(video);
    const titleSvg = path.join(videoDir, '00-title.svg');
    const titlePng = path.join(videoDir, '00-title.png');
    writeFileSync(titleSvg, poster, 'utf8');
    await rasterizeSvg(page, titleSvg, titlePng);
    const posterFile = path.join(outputDir, `${video.slug}.png`);
    copyFileSync(titlePng, posterFile);
    rmSync(path.join(outputDir, `${video.slug}.svg`), { force: true });

    const frames = [titlePng];
    for (const [index, slide] of video.slides.entries()) {
      const baseName = `${String(index + 1).padStart(2, '0')}-${video.slug}`;
      const svgFilename = path.join(videoDir, `${baseName}.svg`);
      const pngFilename = path.join(videoDir, `${baseName}.png`);
      writeFileSync(svgFilename, lessonFrame(video, slide, index), 'utf8');
      await rasterizeSvg(page, svgFilename, pngFilename);
      frames.push(pngFilename);
    }

    const videoFile = encodeVideo(ffmpeg, video, frames, narration);
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
      hasSynthesizedSpeech: true,
      voice: 'Microsoft Zira Desktop',
      duration: video.duration,
      durationSeconds: narration.reduce((total, part) => total + part.duration, 0),
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
    format: `${width}x${height} H.264/AAC MP4 with PNG posters, synthesized English narration, and WebVTT captions`,
    provenance: 'Original scripts and code-rendered visual design. Narration synthesized locally with Windows System.Speech (Microsoft Zira Desktop). No third-party footage or recorded audio.',
    videos: manifest,
  }, null, 2)}\n`, 'utf8');

  writeFileSync(path.join(provenanceDir, 'NOTICE.md'), [
    '# UFI Career Studio Media Provenance',
    '',
    'These preparation lessons were produced in-house from the original scripts and',
    'code-rendered visual system in web/scripts/generate-preparation-videos.mjs.',
    'Narration uses Windows System.Speech with Microsoft Zira Desktop. Scripts are original.',
    'They contain no third-party footage, recorded audio, logos, thumbnails, or embedded media.',
    '',
    'Copyright UFIConnect. All rights reserved.',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.resolve(__dirname, '../src/data/preparationDurations.js'), `export default ${JSON.stringify(durations, null, 2)};\n`);
} finally {
  await browser.close();
  if (path.dirname(workingDir) !== path.resolve(tmpdir()) || !path.basename(workingDir).startsWith('ufi-preparation-')) throw new Error('Unexpected temporary media directory');
  rmSync(workingDir, { recursive: true, force: true });
}
