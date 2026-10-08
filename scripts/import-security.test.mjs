import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readImportText } from '../web/src/utils/importText.mjs';
import { parsePasswordImport } from '../web/src/vault/localVault.mjs';

test('text imports reject oversized or empty files before reading and enforce actual UTF-8 bytes', async () => {
  let reads = 0;
  for (const size of [0, -1, 101, NaN, undefined]) {
    await assert.rejects(readImportText({ size, text() { reads++; } }, 100, 'Size limit'), /Size limit/);
  }
  assert.equal(reads, 0);
  await assert.rejects(readImportText({ size: 1, text: async () => 'a'.repeat(101) }, 100, 'Size limit'), /Size limit/);
  await assert.rejects(readImportText({ size: 1, text: async () => '€'.repeat(34) }, 100, 'Size limit'), /Size limit/);
  assert.equal(await readImportText(new File(['€'.repeat(33) + 'a'], 'report.json'), 100, 'Size limit'), '€'.repeat(33) + 'a');
});

test('password imports reject malformed CSV instead of silently changing credential bytes', () => {
  for (const csv of [
    'name,password\nApp,"secret"suffix',
    'name,password\nApp,"secret""',
    'name,password\nApp,s"ecret',
    'name,password,password\nApp,first,second',
    'name,password\nApp,secret,unexpected',
    'name,password\nApp',
  ]) assert.throws(() => parsePasswordImport(csv, 'passwords.csv'), /CSV|columns|quote/);
  const [entry] = parsePasswordImport('name,password\n"<script>literal</script>"," =+exact""\nsecret"', 'passwords.csv');
  assert.equal(entry.name, '<script>literal</script>'); assert.equal(entry.password, ' =+exact"\nsecret');
  assert.throws(() => parsePasswordImport('name,password\nApp,' + 's'.repeat(16385)), /field.*large/);
});

test('password JSON imports reject invalid records and excessive entries before normalization', () => {
  for (const value of [[null], ['password'], [[]]]) assert.throws(() => parsePasswordImport(JSON.stringify(value), 'passwords.json'), /entry is invalid/);
  assert.throws(() => parsePasswordImport(JSON.stringify(Array.from({ length: 1001 }, () => ({ name: 'App', password: 'secret' }))), 'passwords.json'), /1,000 passwords/);
  const [entry] = parsePasswordImport('[{"name":"App","password":"secret","__proto__":{"polluted":true},"extraSecret":"discarded"}]', 'passwords.json');
  assert.equal(entry.password, 'secret'); assert.equal(Object.hasOwn(entry, 'extraSecret'), false); assert.equal({}.polluted, undefined);
});
