const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const braces = require('braces');
const forge = require('node-forge');
const { patchText, processPatches, manifest } = require('./dependencyPatches.cjs');
const { assessAudit } = require('./dependencyAudit.cjs');

test('braces rejects excessive input nesting across public APIs', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const input = open.repeat(4000) + 'x' + close.repeat(4000);
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[method](input), /exceeds max depth/);
      assert.throws(() => braces[method](input, { maxDepth: 10000 }), /exceeds max depth/);
      assert.doesNotThrow(() => braces[method](open.repeat(100) + 'x' + close.repeat(100)));
      assert.throws(() => braces[method](open.repeat(101) + 'x' + close.repeat(101)), /exceeds max depth/);
    }
  }
  assert.throws(() => braces.parse('{{a,b},c}', { maxDepth: 1.5 }), /exceeds max depth/);
});

test('braces bounds supplied ASTs and rejects cyclic parent links', () => {
  for (const method of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'text', value: 'x' };
    for (let i = 0; i < 101; i++) ast = { type: 'brace', nodes: [ast] };
    assert.throws(() => braces[method]({ type: 'root', nodes: [ast] }), /exceeds max depth/);
  }
  const ast = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
  ast.parent = ast;
  assert.throws(() => vm.runInNewContext('braces.expand(ast)', { braces, ast }, { timeout: 1000 }), /parent chain contains a cycle/);
});

test('braces preserves ordinary file globs, ranges and stringify behavior', () => {
  assert.deepEqual(braces.expand('src/{screens,components}/*.{js,jsx}'), [
    'src/screens/*.js', 'src/screens/*.jsx', 'src/components/*.js', 'src/components/*.jsx',
  ]);
  assert.deepEqual(braces.expand('file{1..3}.js'), ['file1.js', 'file2.js', 'file3.js']);
  assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)']);
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  const micromatch = require('micromatch');
  assert.deepEqual(micromatch(['app/a.js', 'app/b.tsx', 'app/c.png'], 'app/*.{js,tsx}'), ['app/a.js', 'app/b.tsx']);
});

test('RSA rejects nested DigestAlgorithm garbage while accepting legitimate signatures', () => {
  const a = forge.asn1;
  const node = (type, constructed, value) => a.create(a.Class.UNIVERSAL, type, constructed, value);
  const digest = crypto.createHash('sha256').update('UFI dependency regression fixture').digest();
  for (const publicExponent of [3, 65537]) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent });
    const verifier = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
    const oid = node(a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes());
    const nil = node(a.Type.NULL, false, '');
    const garbage = node(a.Type.OCTETSTRING, false, 'unconsumed attacker-controlled bytes');
    const signature = (children, extraOuter = false) => {
      const outer = [node(a.Type.SEQUENCE, true, children), node(a.Type.OCTETSTRING, false, digest.toString('binary'))];
      if (extraOuter) outer.push(garbage);
      const der = Buffer.from(a.toDer(node(a.Type.SEQUENCE, true, outer)).getBytes(), 'binary');
      const em = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(256 - der.length - 3, 255), Buffer.from([0]), der]);
      return crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, em).toString('binary');
    };
    for (const children of [[oid], [oid, nil]]) {
      const sig = signature(children);
      assert.equal(verifier.verify(digest.toString('binary'), sig), true);
      assert.equal(verifier.verify('wrong digest', sig), false);
    }
    for (const children of [[oid, nil, garbage], [oid, garbage], [oid, nil, nil]]) {
      assert.throws(() => verifier.verify(digest.toString('binary'), signature(children)), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
    }
    assert.throws(() => verifier.verify(digest.toString('binary'), signature([oid, nil], true)), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
    const message = Buffer.from('valid native RSA signature');
    const valid = crypto.sign('sha256', message, privateKey);
    assert.equal(verifier.verify(crypto.createHash('sha256').update(message).digest('binary'), valid.toString('binary')), true);
  }
});

test('backports are installed exactly and reject unexpected file contents', () => {
  processPatches();
  assert.throws(() => patchText('modified dependency', manifest.packages[0].files[0]), /Unrecognized upstream file/);
});

test('audit only accepts proven backports and their dependency chains', () => {
  const verified = new Map(manifest.packages.map(p => [p.name, { advisory: p.advisory, nodes: new Set([`node_modules/${p.name}`]) }]));
  const report = { auditReportVersion: 2, metadata: { vulnerabilities: {} }, vulnerabilities: {} };
  for (const p of manifest.packages) report.vulnerabilities[p.name] = { severity: 'high', nodes: [`node_modules/${p.name}`], via: [{ name: p.name, url: `https://github.com/advisories/${p.advisory}` }] };
  report.vulnerabilities.expo = { severity: 'high', via: ['braces', 'node-forge'] };
  const now = new Date('2026-10-03');
  assert.deepEqual(assessAudit(report, verified, now).blocked, []);
  report.vulnerabilities.metro = { severity: 'high', via: ['expo'] };
  report.vulnerabilities.expo.via.push('metro');
  assert.deepEqual(assessAudit(report, verified, now).blocked, []);
  report.vulnerabilities.braces.via.push({ name: 'braces', url: 'https://github.com/advisories/GHSA-new-advisory' });
  assert.deepEqual(assessAudit(report, verified, now).blocked.sort(), ['braces', 'expo', 'metro']);
  report.vulnerabilities.braces.via.pop();
  report.vulnerabilities.braces.nodes.push('node_modules/nested/node_modules/braces');
  assert.ok(assessAudit(report, verified, now).blocked.includes('braces'));
  report.vulnerabilities.loop = { severity: 'critical', via: ['loop'] };
  assert.ok(assessAudit(report, verified, now).blocked.includes('loop'));
  assert.throws(() => assessAudit(report, verified, new Date(manifest.reviewBy)), /require upstream review/);
  assert.throws(() => assessAudit({ error: 'offline' }, verified, now), /Invalid or unavailable/);
});
