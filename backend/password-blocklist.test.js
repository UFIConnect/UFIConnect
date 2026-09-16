const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { passwordBlocklistError } = require('./password-blocklist');
const corpus = require('./security-data/common-passwords.json');

test('new-password screening uses an attributed local corpus, with no user-password network request', () => {
  assert.ok(corpus.sourceEntryCount >= 90000);
  assert.match(corpus.source, /\/SecLists\/blob\/[a-f0-9]{40}\//);
  assert.match(corpus.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(corpus.hashes).size, corpus.hashes.length);
  assert.ok(corpus.hashes.length >= 100);
  assert.ok(corpus.hashes.every(value => /^[a-f0-9]{64}$/.test(value)));
  // This public, compromised example must be represented in the source corpus.
  const known = '123456789012345';
  assert.ok(corpus.hashes.includes(crypto.createHash('sha256').update(known).digest('hex')));
  assert.ok(passwordBlocklistError(known));
});

test('common full passwords, repeated strings and service-name guesses are rejected', () => {
  for (const value of ['a'.repeat(15), 'abcd'.repeat(6), '😀'.repeat(15), 'qwertyuiopqwertyuiop', 'PasswordPassword', 'UFIConnect2026!!', 'ＰａｓｓｗｏｒｄＰａｓｓｗｏｒｄ']) {
    assert.ok(passwordBlocklistError(value), 'A predictable candidate should be rejected');
  }
});

test('screening compares whole candidates and preserves uncommon passphrases and character choices', () => {
  for (const value of ['Copper rivers orbit seven lanterns', 'A password can contain unrelated orchard words', 'My uficonnect journey crosses violet bridges', 'quartz-🦊-puzzle-7-cobalt', '  copper rivers orbit seven lanterns  ']) {
    assert.equal(passwordBlocklistError(value), null);
  }
});
