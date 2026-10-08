const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deflateRawSync, crc32 } = require('node:zlib');
const { validateResumeUpload, validateDocxArchive, extractResumeText, MAX_RESUME_BYTES, MAX_DOCX_ENTRY_BYTES, MAX_DOCX_ENTRIES, MAX_RESUME_TEXT_CHARS } = require('./resume-import');

function archive(entries, { descriptor = false } = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), raw = Buffer.from(entry.contents), compressed = deflateRawSync(raw);
    const expanded = entry.declaredSize ?? raw.length, checksum = crc32(raw), flags = descriptor ? 8 : 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(8, 8);
    if (!descriptor) { header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(expanded, 22); }
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(flags, 8); record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(expanded, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    let trailer = Buffer.alloc(0);
    if (descriptor) { trailer = Buffer.alloc(16); trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(checksum, 4); trailer.writeUInt32LE(compressed.length, 8); trailer.writeUInt32LE(expanded, 12); local.push(trailer); }
    central.push(record, name); offset += header.length + name.length + compressed.length + trailer.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const parts = [
  { name: '[Content_Types].xml', contents: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
  { name: 'word/document.xml', contents: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Example resume</w:t></w:r></w:p></w:body></w:document>' },
];
const upload = (buffer, originalname = 'resume.docx') => ({ buffer, originalname, size: buffer.length, mimetype: 'text/html' });

test('resume imports verify content and derive MIME types independently of multipart metadata', async () => {
  const docx = archive(parts);
  assert.equal(validateResumeUpload(upload(docx)).mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal((await extractResumeText(docx, 'resume.docx')).trim(), 'Example resume');
  assert.doesNotThrow(() => validateDocxArchive(archive(parts, { descriptor: true })), 'Standard ZIP data descriptors remain supported');
  const text = validateResumeUpload(upload(Buffer.from('Resume text'), '../../resume.txt'));
  assert.equal(text.filename, 'resume.txt'); assert.equal(text.mimeType, 'text/plain; charset=utf-8');
  assert.throws(() => validateResumeUpload(upload(Buffer.from('<html>wrong type</html>'), 'resume.pdf')), /not a PDF/);
  assert.throws(() => validateResumeUpload(upload(Buffer.from('not an archive'))), /DOCX archive/);
  assert.throws(() => validateResumeUpload(upload(Buffer.from('binary\0bytes'), 'resume.txt')), /not a plain text/);
  assert.throws(() => validateResumeUpload({ ...upload(Buffer.from('resume'), 'resume.txt'), size: 1 }), /nonempty/);
  assert.throws(() => validateResumeUpload(upload(Buffer.alloc(MAX_RESUME_BYTES + 1), 'resume.txt')), error => error.status === 413);
});

test('DOCX inflation is capped even when forged archive sizes claim small entries', () => {
  const contents = Buffer.alloc(MAX_DOCX_ENTRY_BYTES + 1, 65);
  const large = archive([...parts, { name: 'word/bomb.xml', contents }]);
  assert.ok(large.length < 10000, 'The compressed upload passes the old 8 MB check');
  assert.throws(() => validateDocxArchive(large), error => error.status === 413);
  const forged = archive([...parts, { name: 'word/bomb.xml', contents, declaredSize: 128 }]);
  assert.throws(() => validateDocxArchive(forged), error => error.status === 413, 'Actual inflation is bounded before allocating the full advertised payload');
  assert.throws(() => validateDocxArchive(archive([...parts, { name: 'word/not-xml.xml', contents: 'bad', declaredSize: 100 }])), /invalid/);
  const many = [...parts, ...Array.from({ length: MAX_DOCX_ENTRIES }, (_, index) => ({ name: `media/${index}`, contents: '' }))];
  assert.throws(() => validateDocxArchive(archive(many)), error => error.status === 413);
});

test('malformed, conflicting, traversal, and XML entity DOCX archives are rejected before extraction', () => {
  for (const buffer of [
    archive([...parts, parts[1]]),
    archive([...parts, { name: '../word/extra.xml', contents: '' }]),
    archive([{ ...parts[0] }, { ...parts[1], contents: '<!DOCTYPE doc [<!ENTITY x "payload">]><doc>&x;</doc>' }]),
    archive([parts[0]]),
    archive(parts).subarray(0, -1),
  ]) assert.throws(() => validateDocxArchive(buffer), /DOCX archive/);
  const mismatch = archive(parts); mismatch.writeUInt32LE(0, 14);
  assert.throws(() => validateDocxArchive(mismatch), /DOCX archive/);
  const encrypted = archive(parts); encrypted.writeUInt16LE(1, 6);
  assert.throws(() => validateDocxArchive(encrypted), /DOCX archive/);
  const corrupt = archive(parts); corrupt[30 + Buffer.byteLength(parts[0].name) + 5] ^= 0xff;
  assert.throws(() => validateDocxArchive(corrupt), /DOCX archive/);
});

test('PDF extraction limits pages and text, disables eval, and releases parsers on success and failure', async () => {
  let pages = 1, content = 'Resume', textFailure = false, destroyed = 0, textCalls = 0;
  class Parser {
    constructor(options) { assert.equal(options.isEvalSupported, false); }
    async getInfo() { return { total: pages }; }
    async getText(options) { textCalls++; assert.equal(options.first, 50); if (textFailure) throw new Error('Invalid PDF'); return { text: content }; }
    async destroy() { destroyed++; }
  }
  const extract = () => extractResumeText(Buffer.from('%PDF-1.7'), 'resume.pdf', { PDFParse: Parser });
  assert.equal(await extract(), 'Resume'); assert.equal(destroyed, 1);
  pages = 51; await assert.rejects(extract(), error => error.status === 413); assert.equal(textCalls, 1); assert.equal(destroyed, 2);
  pages = 1; content = 'x'.repeat(MAX_RESUME_TEXT_CHARS + 1); await assert.rejects(extract(), error => error.status === 413); assert.equal(destroyed, 3);
  textFailure = true; await assert.rejects(extract(), /Invalid PDF/); assert.equal(destroyed, 4);
  await assert.rejects(extractResumeText(Buffer.from('x'.repeat(MAX_RESUME_TEXT_CHARS + 1)), 'resume.txt'), error => error.status === 413);
});

test('real attachment routes reject hostile files before extraction and bind inert downloads to their owner', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const owner = 'resume-import-owner', other = 'resume-import-other';
  let stored, extractions = 0;
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id, name, billing_closed FROM users')) return { rows: [{ id: params[0], name: 'Synthetic owner', billing_closed: false }] };
    if (sql.includes('INSERT INTO attachments')) {
      stored = { id: params[0], owner: params[1], filename: params[2], mime_type: params[3], file_data: params[5] };
    }
    if (sql.includes('SELECT filename, mime_type, file_data FROM attachments')) return { rows: stored && params[0] === stored.id && params[1] === stored.owner ? [stored] : [] };
    return { rows: [] };
  } });
  t.after(() => app.close());
  app.seedUser(member(owner)); app.seedUser(member(other));
  app.setResumeExtraction(async (buffer, filename) => { extractions++; return extractResumeText(buffer, filename); });
  const send = (buffer, filename, { userId = owner, additionalField = false, additionalFile = false } = {}) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'text/html' }), filename);
    if (additionalField) form.append('ignored', 'unexpected');
    if (additionalFile) form.append('file', new Blob(['second']), 'second.txt');
    return fetch(app.base + '/profile/attachments', { method: 'POST', headers: userId ? { authorization: `Bearer ${app.token(userId)}` } : {}, body: form });
  };
  assert.equal((await send(Buffer.from('resume'), 'resume.txt', { userId: null })).status, 401);
  assert.equal((await send(Buffer.from('<html>bad signature</html>'), 'resume.pdf')).status, 400);
  const bomb = archive([...parts, { name: 'word/bomb.xml', contents: Buffer.alloc(MAX_DOCX_ENTRY_BYTES + 1, 65), declaredSize: 128 }]);
  assert.equal((await send(bomb, 'resume.docx')).status, 413);
  assert.equal((await send(Buffer.from('resume'), 'resume.txt', { additionalField: true })).status, 400);
  assert.equal((await send(Buffer.from('resume'), 'resume.txt', { additionalFile: true })).status, 400);
  assert.equal(extractions, 0); assert.equal(stored, undefined);
  assert.equal(app.queries.some(query => query.sql.includes('INSERT INTO attachments')), false);
  const text = 'Synthetic resume\nExperience\nSkills: JavaScript';
  const uploaded = await send(Buffer.from(text), 'resume.txt');
  assert.equal(uploaded.status, 201, 'The single-file multipart boundary must be accepted');
  const result = await uploaded.json();
  assert.equal(result.mimeType, 'text/plain; charset=utf-8'); assert.equal(stored.mime_type, result.mimeType); assert.equal(extractions, 1);
  const ownDownload = await app.request(`/profile/attachments/${result.id}/download`, { userId: owner });
  assert.equal(ownDownload.status, 200); assert.equal(ownDownload.data, text);
  assert.equal(ownDownload.headers.get('content-type'), 'application/octet-stream');
  assert.equal(ownDownload.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ownDownload.headers.get('cache-control'), 'no-store');
  assert.match(ownDownload.headers.get('content-disposition'), /^attachment;/);
  assert.equal((await app.request(`/profile/attachments/${result.id}/download`, { userId: other })).status, 404);
  assert.equal((await app.request(`/profile/attachments/${result.id}/download`)).status, 401);
});
