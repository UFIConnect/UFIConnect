const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createOfficeAIWeb, publicUrl, publicIPv4, documentText, messageUrls } = require('./office-ai-web');
function fixture(pages, lookup = async () => [{ address: '93.184.216.34', family: 4 }]) {
  const sent = [];
  const request = (url, options, callback) => {
    sent.push({ url: url.href, options });
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const page = pages.shift();
      const response = Readable.from(page.chunks || [Buffer.from(page.body || '')]);
      response.statusCode = page.status || 200; response.headers = { 'content-type': 'text/html', ...page.headers };
      callback(response);
    });
    return req;
  };
  return { sent, web: createOfficeAIWeb({ request, lookup, now: () => Date.parse('2026-11-04T00:00:00Z') }) };
}
test('web targets exclude private literals, credentials, private hostnames, ports and secret query values', () => {
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://app.internal/', 'https://example.com:8443', 'https://user:password@example.com', 'https://example.com?access_token=secret']) {
    assert.throws(() => publicUrl(url), { status: 400 }, url);
  }
  for (const address of ['10.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '0.0.0.0', '224.0.0.1', '::ffff:127.0.0.1']) assert.equal(publicIPv4(address), false);
  assert.equal(publicIPv4('93.184.216.34'), true);
  assert.deepEqual(messageUrls('Read https://example.com/a and https://example.com/a then https://example.org/b.'), ['https://example.com/a', 'https://example.org/b']);
});
test('read pins validated DNS and sends no Office or provider credentials', async () => {
  const f = fixture([{ body: '<html><title>Primary source</title><script>secret script</script><nav>hidden menu</nav><p>Hello &amp; world</p><a href="/next">Next</a></html>' }]);
  const value = await f.web.read('https://example.com/page');
  assert.equal(value.title, 'Primary source'); assert.match(value.content, /Hello & world/); assert.doesNotMatch(value.content, /secret script|hidden menu/);
  assert.equal(value.links[0].url, 'https://example.com/next'); assert.equal(value.checkedAt, '2026-11-04T00:00:00.000Z');
  const options = f.sent[0].options;
  assert.equal(options.method, 'GET'); assert.equal(options.agent, false);
  assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers['x-office-token'], undefined);
  options.lookup('example.com', { all: true }, (_error, addresses) => assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]));
});
test('any blocked DNS answer prevents a request, and every redirect is checked independently', async () => {
  const blocked = fixture([], async () => [{ address: '93.184.216.34' }, { address: '10.0.0.1' }]);
  await assert.rejects(blocked.web.read('https://example.com'), { status: 400 }); assert.equal(blocked.sent.length, 0);
  const redirected = fixture([{ status: 302, headers: { location: 'https://private.example/path' } }], async host => [{ address: host === 'example.com' ? '93.184.216.34' : '169.254.169.254' }]);
  await assert.rejects(redirected.web.read('https://example.com'), { status: 400 }); assert.equal(redirected.sent.length, 1);
});
test('web reader bounds response size, rejects downloads and does not bypass access errors', async () => {
  await assert.rejects(fixture([{ chunks: [Buffer.alloc(1024 * 1024 + 1)] }]).web.read('https://example.com'), { status: 413 });
  await assert.rejects(fixture([{ headers: { 'content-type': 'application/octet-stream' } }]).web.read('https://example.com'), { status: 415 });
  await assert.rejects(fixture([{ status: 403 }]).web.read('https://example.com'), error => error.status === 502 && /access restrictions/.test(error.message));
  const document = documentText('<title>X</title><p>' + 'A'.repeat(9000) + '</p>', 'text/html', 'https://example.com');
  assert.equal(document.content.length, 6000); assert.equal(document.truncated, true);
});
test('abort interrupts a pending DNS lookup and releases concurrency capacity', async () => {
  const f = fixture([], () => new Promise(() => {}));
  for (let index = 0; index < 4; index++) {
    const controller = new AbortController(), pending = f.web.read('https://example.com', { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { status: 504 });
  }
  assert.equal(f.sent.length, 0);
});
