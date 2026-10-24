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

// GHSA-mrhx-c7xc-m3w5: a declared upper bound must stop the element walk.
const zodEntries = [
  ['root CommonJS', 3, () => require('zod')],
  ['v3 CommonJS', 3, () => require('zod/v3')],
  ['v4 CommonJS', 4, () => require('zod/v4')],
  ['mini CommonJS', 4, () => require('zod/v4/mini')],
  ['root ES module', 3, () => import('zod')],
  ['v3 ES module', 3, () => import('zod/v3')],
  ['v4 ES module', 4, () => import('zod/v4')],
  ['mini ES module', 4, () => import('zod/v4/mini')],
];
for (const [entryName, version, load] of zodEntries) {
  test(`Zod ${entryName} rejects oversized collections before sync or async child validation`, async () => {
    const z = await load();
    let visited = 0, refined = 0;
    const rejectChild = () => { visited++; return false; };
    const child = version === 3 ? z.string().refine(rejectChild) : z.string().check(z.refine(rejectChild));
    const after = () => { refined++; return true; };
    const cases = version === 3 ? [
      [z.array(child).max(2, 'cap').refine(after), Array(2000).fill('x')],
      [z.array(child).length(2, 'cap').refine(after), Array(2000).fill('x')],
      [z.set(child).max(2, 'cap').refine(after), new Set(Array.from({ length: 2000 }, (_, i) => String(i)))],
    ] : [
      [z.array(child).check(z.maxLength(2, { error: 'cap' }), z.refine(after)), Array(2000).fill('x')],
      [z.array(child).check(z.length(2, { error: 'cap' }), z.refine(after)), Array(2000).fill('x')],
      [z.set(child).check(z.maxSize(2, { error: 'cap' }), z.refine(after)), new Set(Array.from({ length: 2000 }, (_, i) => String(i)))],
      [z.map(child, child).check(z.maxSize(2, { error: 'cap' }), z.refine(after)), new Map(Array.from({ length: 2000 }, (_, i) => [String(i), 'x']))],
    ];
    for (const [schema, input] of cases) {
      for (const result of [schema.safeParse(input), await schema.safeParseAsync(input)]) {
        assert.equal(result.success, false);
        assert.equal(result.error.issues.length, 1);
        assert.equal(result.error.issues[0].code, 'too_big');
        assert.equal(result.error.issues[0].message, 'cap');
      }
      assert.equal(visited, 0, 'No child refinement should run after the declared upper bound is exceeded');
      assert.equal(refined, 0, 'Later collection refinements must not inspect unparsed input');
    }
    const asyncChild = async () => { visited++; return false; };
    const asyncAfter = async () => { refined++; return true; };
    const asyncSchema = version === 3
      ? z.array(z.string().refine(asyncChild)).max(2).refine(asyncAfter)
      : z.array(z.string().check(z.refine(asyncChild))).check(z.maxLength(2), z.refine(asyncAfter));
    // The bounds reject before either asynchronous callback creates a promise.
    assert.equal(asyncSchema.safeParse(Array(2000).fill('x')).error.issues.length, 1);
    assert.equal((await asyncSchema.safeParseAsync(Array(2000).fill('x'))).error.issues.length, 1);
    assert.equal(visited, 0);
    assert.equal(refined, 0);
    assert.equal((await asyncSchema.safeParseAsync(['x'])).success, false);
    assert.equal(visited, 1, 'An ordinary async input still invokes its child validator');
  });

  test(`Zod ${entryName} preserves ordinary values, errors, nesting and check order`, async () => {
    const z = await load();
    const strings = version === 3 ? z.array(z.string()).max(2) : z.array(z.string()).check(z.maxLength(2));
    assert.deepEqual(strings.parse(['a', 'b']), ['a', 'b']);
    assert.deepEqual(await strings.parseAsync(['a']), ['a']);
    assert.deepEqual(strings.parse([]), []);
    const invalid = strings.safeParse([1, 2]);
    assert.equal(invalid.success, false);
    assert.deepEqual(invalid.error.issues.map(issue => issue.path), [[0], [1]]);
    assert.equal(strings.safeParse('wrong type').error.issues[0].code, 'invalid_type');
    const nested = z.object({ items: strings }).safeParse({ items: ['a', 'b', 'c'] });
    assert.deepEqual(nested.error.issues.map(issue => issue.path), [['items']]);
    const tooSmall = version === 3 ? z.array(z.string()).min(2) : z.array(z.string()).check(z.minLength(2));
    assert.equal(tooSmall.safeParse([]).error.issues[0].code, 'too_small');
    const exact = version === 3 ? z.array(z.string()).length(2) : z.array(z.string()).check(z.length(2));
    assert.deepEqual(exact.parse(['a', 'b']), ['a', 'b']);
    assert.equal(exact.safeParse(['a']).error.issues[0].code, 'too_small');
    const sets = version === 3 ? z.set(z.string()).max(2) : z.set(z.string()).check(z.maxSize(2));
    assert.deepEqual(sets.parse(new Set(['a', 'b'])), new Set(['a', 'b']));
    assert.equal(sets.safeParse(new Set([1])).error.issues[0].code, 'invalid_type');
    // Unbounded collections are intentionally unchanged, matching upstream's scope.
    assert.equal(z.array(z.string()).parse(Array(2000).fill('a')).length, 2000);
    if (version === 4) {
      const maps = z.map(z.string(), z.number()).check(z.maxSize(2));
      assert.deepEqual(maps.parse(new Map([['a', 1]])), new Map([['a', 1]]));
      assert.equal(maps.safeParse(new Map([['a', 'wrong type']])).error.issues[0].code, 'invalid_type');
      const rewritten = z.array(z.number()).check(z.overwrite(values => values.slice(0, 2)), z.maxLength(2));
      assert.deepEqual(rewritten.parse([1, 2, 3]), [1, 2]);
      const conditional = z.array(z.string()).check(z.maxLength(1, { when: () => false }));
      assert.deepEqual(conditional.parse(['a', 'b']), ['a', 'b']);
    }
  });
}

test('Zod audit coverage requires the exact advisory and every installed package copy', () => {
  const entry = manifest.packages.find(item => item.name === 'zod');
  assert.ok(entry);
  const verified = new Map([['zod', { advisory: entry.advisory, nodes: new Set(['node_modules/zod']) }]]);
  const report = { auditReportVersion: 2, metadata: { vulnerabilities: {} }, vulnerabilities: {
    zod: { severity: 'high', nodes: ['node_modules/zod'], via: [{ name: 'zod', url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5' }] },
    '@expo/cli': { severity: 'high', via: ['zod'] }, expo: { severity: 'high', via: ['@expo/cli'] },
  } };
  assert.deepEqual(assessAudit(report, verified, new Date('2026-10-24')).blocked, []);
  assert.deepEqual(assessAudit(report, new Map(), new Date('2026-10-24')).blocked.sort(), ['@expo/cli', 'expo', 'zod']);
  report.vulnerabilities.zod.nodes.push('node_modules/nested/node_modules/zod');
  assert.deepEqual(assessAudit(report, verified, new Date('2026-10-24')).blocked.sort(), ['@expo/cli', 'expo', 'zod']);
  report.vulnerabilities.zod.nodes.pop();
  report.vulnerabilities.zod.via[0].url = 'https://github.com/advisories/GHSA-unreviewed';
  assert.deepEqual(assessAudit(report, verified, new Date('2026-10-24')).blocked.sort(), ['@expo/cli', 'expo', 'zod']);
});

