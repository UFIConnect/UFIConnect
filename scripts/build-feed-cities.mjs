import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] || '');
const snapshot = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot || '')) throw Error('Supply a local GeoNames source directory and snapshot date.');
const cityBytes = await fs.readFile(path.join(input, 'cities500.txt'));
const regions = Object.fromEntries((await fs.readFile(path.join(input, 'admin1CodesASCII.txt'), 'utf8')).trim().split(/\r?\n/)
  .map(line => { const fields = line.split('\t'); return [fields[0], fields[1]]; }));
const cities = cityBytes.toString('utf8').trim().split(/\r?\n/).map(line => {
  const f = line.split('\t');
  return [f[1], f[2] === f[1] ? '' : f[2], f[8], f[10], Number(f[4]), Number(f[5])];
}).filter(row => row[0] && /^[A-Z]{2}$/.test(row[2]) && Number.isFinite(row[4]) && Math.abs(row[4]) <= 90 && Number.isFinite(row[5]) && Math.abs(row[5]) <= 180);
if (cities.length < 150000) throw Error('GeoNames city coverage is unexpectedly incomplete.');
const data = { version: 1, snapshot, source: 'https://download.geonames.org/export/dump/cities500.zip', license: 'CC-BY-4.0',
  sourceSha256: createHash('sha256').update(cityBytes).digest('hex'), regions, cities };
const output = path.join(root, 'backend/geo/feed-cities.json.gz');
await fs.mkdir(path.dirname(output), { recursive: true });
const compressed = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
await fs.writeFile(output, compressed);
console.log(JSON.stringify({ cities: cities.length, regions: Object.keys(regions).length, bytes: compressed.length, snapshot }));
