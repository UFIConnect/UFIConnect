const { inflateRawSync, crc32 } = require('node:zlib');

const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 512;
const MAX_DOCX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_DOCX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_RESUME_TEXT_CHARS = 200000;
const MAX_RESUME_PAGES = 50;
const MIME_TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain; charset=utf-8' };

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function invalidArchive() { return failure('This DOCX archive is invalid or unsupported.'); }

// Check both the archive directory and the actual inflated bytes before the
// document parser can allocate strings or XML trees from an uploaded DOCX.
// Directory sizes alone are attacker-controlled and do not bound inflation.
function validateDocxArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw invalidArchive();
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalidArchive();
  const count = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12), directoryOffset = buffer.readUInt32LE(end + 16);
  if (!count || count !== buffer.readUInt16LE(end + 8) || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || directoryOffset + directorySize !== end) throw invalidArchive();
  if (count > MAX_DOCX_ENTRIES) throw failure('This DOCX contains too many archive entries.', 413);
  let cursor = directoryOffset, total = 0;
  const names = new Set(), ranges = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalidArchive();
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), checksum = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || nameLength > 1024 || next > end || buffer.readUInt16LE(cursor + 34)
      || flags & (1 | 0x40 | 0x2000) || ![0, 8].includes(method) || [compressed, expanded, localOffset].includes(0xffffffff)) throw invalidArchive();
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength), name = nameBytes.toString('utf8');
    if (names.has(name) || /[\\\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')) throw invalidArchive();
    names.add(name);
    total += expanded;
    if (expanded > MAX_DOCX_ENTRY_BYTES || total > MAX_DOCX_TOTAL_BYTES) throw failure('This DOCX expands beyond the document size limit.', 413);
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50
      || buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method) throw invalidArchive();
    const localNameLength = buffer.readUInt16LE(localOffset + 26), localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (localNameLength !== nameLength || dataEnd > directoryOffset
      || !buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)) throw invalidArchive();
    if (!(flags & 8) && (buffer.readUInt32LE(localOffset + 14) !== checksum || buffer.readUInt32LE(localOffset + 18) !== compressed
      || buffer.readUInt32LE(localOffset + 22) !== expanded)) throw invalidArchive();
    ranges.push({ start: localOffset, end: dataEnd });
    let contents;
    try {
      contents = method === 0 ? buffer.subarray(dataStart, dataEnd)
        : inflateRawSync(buffer.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, Math.min(MAX_DOCX_ENTRY_BYTES, expanded)) });
    } catch (error) {
      if (error.code === 'ERR_BUFFER_TOO_LARGE') throw failure('This DOCX expands beyond the document size limit.', 413);
      throw invalidArchive();
    }
    try {
      if (contents.length !== expanded || crc32(contents) !== checksum) throw invalidArchive();
      if (/\.(?:xml|rels)$/i.test(name) && /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(contents.toString('utf8'))) throw invalidArchive();
    } finally { if (method === 8) contents.fill(0); }
    cursor = next;
  }
  if (cursor !== end || !names.has('[Content_Types].xml') || !names.has('word/document.xml')) throw invalidArchive();
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.some((range, index) => index && range.start < ranges[index - 1].end)) throw invalidArchive();
}

function validateResumeUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !Number.isSafeInteger(file.size) || file.size !== file.buffer.length || file.size < 1) throw failure('Choose a nonempty resume file.');
  if (file.size > MAX_RESUME_BYTES) throw failure('File is too large — 8 MB max.', 413);
  if (typeof file.originalname !== 'string' || file.originalname.length > 1024) throw failure('The resume filename is invalid.');
  const filename = file.originalname.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const ext = filename.split('.').at(-1).toLowerCase();
  if (!filename || filename.length > 255 || !Object.hasOwn(MIME_TYPES, ext)) throw failure('Only PDF, DOCX, and TXT files are supported.');
  if (ext === 'pdf' && !/^%PDF-\d\.\d/.test(file.buffer.subarray(0, 8).toString('ascii'))) throw failure('This file is not a PDF document.');
  if (ext === 'docx') validateDocxArchive(file.buffer);
  if (ext === 'txt' && file.buffer.includes(0)) throw failure('This file is not a plain text document.');
  return { filename, mimeType: MIME_TYPES[ext], ext };
}

async function extractResumeText(buffer, filename, { PDFParse, mammoth } = {}) {
  const ext = filename.split('.').at(-1).toLowerCase();
  let text;
  if (ext === 'pdf') {
    const Parser = PDFParse || require('pdf-parse').PDFParse;
    const parser = new Parser({ data: buffer, isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (!Number.isSafeInteger(info?.total) || info.total < 1 || info.total > MAX_RESUME_PAGES) throw failure('Upload a resume with up to 50 pages.', 413);
      text = (await parser.getText({ first: MAX_RESUME_PAGES }))?.text || '';
    } finally { await parser.destroy(); }
  } else if (ext === 'docx') {
    text = (await (mammoth || require('mammoth')).extractRawText({ buffer }))?.value || '';
  } else if (ext === 'txt') { text = buffer.toString('utf8'); }
  else throw failure('Only PDF, DOCX, and TXT files are supported.');
  if (typeof text !== 'string') throw failure('This resume could not be read.');
  if (text.length > MAX_RESUME_TEXT_CHARS) throw failure('This resume contains too much text.', 413);
  return text;
}

module.exports = { validateResumeUpload, validateDocxArchive, extractResumeText, MAX_RESUME_BYTES, MAX_DOCX_ENTRIES, MAX_DOCX_ENTRY_BYTES, MAX_DOCX_TOTAL_BYTES, MAX_RESUME_TEXT_CHARS, MAX_RESUME_PAGES };
