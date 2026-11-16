import assert from 'node:assert/strict';

const publicWeb = 'https://uficonnect.org';
const publicApi = 'https://api.uficonnect.org';
const baseline = process.argv.includes('--baseline');
const samples = [];

async function probe(label, origin, path, headers = {}) {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), {
    headers: { 'Accept-Encoding': 'br, gzip', ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const toHeadersMs = Math.round(performance.now() - started);
  const body = await response.arrayBuffer();
  const sample = {
    label,
    status: response.status,
    edge: response.headers.get('cf-cache-status') ?? '',
    cacheControl: response.headers.get('cache-control') ?? '',
    encoding: response.headers.get('content-encoding') ?? '',
    toHeadersMs,
  };
  samples.push(sample);
  return { ...sample, headers: response.headers, body };
}

async function repeat(label, origin, path) {
  const first = await probe(label, origin, path);
  const second = await probe(label, origin, path);
  return [first, second];
}

function assertBypass(sample) {
  assert.match(sample.edge, /^(?:BYPASS|DYNAMIC)$/i, `${sample.label}: expected Cloudflare to bypass cache`);
}

function assertNoStore(sample) {
  assertBypass(sample);
  assert.match(sample.cacheControl, /\bno-store\b/i, `${sample.label}: expected no-store`);
}

function assertHit(group) {
  assert.ok(group.some(sample => sample.edge === 'HIT'), `${group[0].label}: expected a cache hit`);
}

function assertStatus(sample, status) {
  assert.equal(sample.status, status, `${sample.label}: expected HTTP ${status}`);
}

try {
  const home = await probe('Anonymous homepage', publicWeb, '/');
  assertStatus(home, 200);
  const html = new TextDecoder().decode(home.body);
  const scriptPath = html.match(/src="(\/assets\/[^"?#]+\.js)"/)?.[1];
  const cssPath = html.match(/href="(\/assets\/[^"?#]+\.css)"/)?.[1];
  assert.ok(scriptPath && cssPath, 'The homepage must reference its current JS and CSS bundles');

  const script = await repeat('Versioned JavaScript', publicWeb, scriptPath);
  const css = await repeat('Versioned CSS', publicWeb, cssPath);
  const appearance = await repeat('Theme stylesheet', publicWeb, '/appearance.css');
  const artwork = await repeat('Homepage WebP', publicWeb, '/homepage-app-network-2026-10-840.webp');
  const cookieHome = await probe('Homepage with cookie', publicWeb, '/', { Cookie: 'cdn_check=1' });
  const queryAsset = await probe('JavaScript with query', publicWeb, scriptPath + '?cdn_check=1');
  const authAsset = await probe('JavaScript with authorization', publicWeb, scriptPath, { Authorization: 'Bearer cdn-check-placeholder' });
  const missing = await repeat('Missing bundle', publicWeb, scriptPath.replace(/[^/]+$/, '__cdn_audit_missing__.js'));
  const media = await probe('First 1024 video bytes', publicWeb, '/media/preparation/technical-interview.mp4', { Range: 'bytes=0-1023' });
  const signIn = await probe('Sign-in shell', publicWeb, '/login/');
  const reset = await probe('Password reset shell', publicWeb, '/reset-password?cdn_check=1');
  const messages = await probe('Messages shell', publicWeb, '/messages/cdn-check');
  const worker = await probe('Service worker', publicWeb, '/sw.js');
  const manifest = await probe('Install manifest', publicWeb, '/manifest.json');
  const api = await probe('API readiness', publicApi, '/readyz');

  if (!baseline) {
    assert.match(home.cacheControl, /\bs-maxage=30(?:\s*,|$)/i);
    for (const group of [script, css, appearance, artwork]) {
      for (const sample of group) assertStatus(sample, 200);
      assertHit(group);
    }
    for (const sample of [...script, ...css]) {
      assert.match(sample.cacheControl, /(?:^|,\s*)max-age=31536000(?:\s*,|$)/i);
      assert.match(sample.cacheControl, /\bimmutable\b/i);
    }
    assert.ok([...script, ...css].some(sample => /^(?:br|gzip)$/i.test(sample.encoding)), 'Expected compressed JS or CSS');
    assert.match(appearance[1].cacheControl, /\bs-maxage=3600(?:\s*,|$)/i);
    assert.match(artwork[1].cacheControl, /\bs-maxage=86400(?:\s*,|$)/i);

    for (const sample of [cookieHome, queryAsset, authAsset]) {
      assertStatus(sample, 200);
      assertBypass(sample);
    }
    for (const sample of [signIn, reset, messages, worker, manifest, api]) {
      assertStatus(sample, 200);
      assertNoStore(sample);
    }
    for (const sample of missing) {
      assertStatus(sample, 404);
      assert.match(sample.cacheControl, /\bno-store\b/i);
      assert.doesNotMatch(sample.cacheControl, /\bimmutable\b/i);
      assert.doesNotMatch(sample.edge, /^(?:HIT|STALE|UPDATING|REVALIDATED)$/i);
    }
    assertStatus(media, 206);
    assert.match(media.headers.get('content-range') ?? '', /^bytes 0-1023\/\d+$/);
    assert.equal(media.body.byteLength, 1024);
  }
} finally {
  console.table(samples);
}
