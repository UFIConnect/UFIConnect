// Browser vault: Web Crypto encrypts every entry before browser storage.
// Neither passphrases nor unwrapped encryption keys are persisted.
export const VAULT_STORAGE_KEY = 'uficonnect.vault.encrypted.v1';
const ITERATIONS = 600000;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = encoder.encode('UFIconnect local vault v1');
const bytes = length => crypto.getRandomValues(new Uint8Array(length));
const b64 = value => btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join(''));
const un64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const storageDefault = () => globalThis.localStorage;

function validBox(box) {
  return box && typeof box.iv === 'string' && typeof box.data === 'string'
    && un64(box.iv).length === 12 && un64(box.data).length >= 16;
}
function parseRecord(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT * 2) throw new Error('This is not a supported encrypted vault backup.');
  let record;
  try {
    record = JSON.parse(text);
    if (record.version !== 1 || record.kdf?.iterations !== ITERATIONS || un64(record.kdf.salt).length !== 16
      || !validBox(record.wrappedKey) || un64(record.wrappedKey.data).length !== 48 || !validBox(record.content)) throw new Error();
    if (record.device && (typeof record.device.id !== 'string' || !un64(record.device.id).length
      || un64(record.device.salt).length !== 32 || !validBox(record.device.wrappedKey)
      || un64(record.device.wrappedKey.data).length !== 48)) throw new Error();
  } catch { throw new Error('This is not a supported encrypted vault backup.'); }
  const copyBox = box => ({ iv: box.iv, data: box.data });
  return { version: 1, kdf: { salt: record.kdf.salt, iterations: ITERATIONS },
    wrappedKey: copyBox(record.wrappedKey), content: copyBox(record.content),
    ...(record.device ? { device: { id: record.device.id, salt: record.device.salt, wrappedKey: copyBox(record.device.wrappedKey) } } : {}) };
}
function readRecord(storage) {
  const text = storage.getItem(VAULT_STORAGE_KEY);
  if (!text) throw new Error('Create a vault or restore an encrypted backup first.');
  return parseRecord(text);
}
async function importKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function wrappingKey(passphrase, salt) {
  const materialBytes = encoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', materialBytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: un64(salt) }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { materialBytes.fill(0); }
}
async function seal(key, plaintext) {
  const iv = bytes(12);
  return { iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext)) };
}
async function open(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(box.iv), additionalData: aad }, key, un64(box.data)));
}
function cleanEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Import up to 1,000 passwords at a time.');
  const seen = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('A password entry is invalid.');
    const result = {};
    for (const field of ['name', 'url', 'username', 'password', 'notes']) {
      const value = entry[field] ?? '';
      if (typeof value !== 'string' || value.length > 16384) throw new Error('A password field is invalid or too large.');
      result[field] = value;
    }
    result.name = result.name.trim() || 'Untitled';
    if (result.url) {
      try {
        const url = new URL(/^https?:\/\//i.test(result.url) ? result.url : `https://${result.url}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
        result.url = url.href;
      } catch { throw new Error('Use a valid website URL without embedded credentials.'); }
    }
    result.id = typeof entry.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) && !seen.has(entry.id) ? entry.id : crypto.randomUUID();
    seen.add(result.id);
    return result;
  });
}
async function contentBox(key, entries) {
  const data = encoder.encode(JSON.stringify({ entries: cleanEntries(entries) }));
  if (data.length > MAX_TEXT) throw new Error('The local vault is limited to 2 MB.');
  try { return await seal(key, data); } finally { data.fill(0); }
}
async function sessionFromRaw(raw, record) {
  try {
    const key = await importKey(raw);
    const plaintext = await open(key, record.content);
    try { return { key, entries: cleanEntries(JSON.parse(decoder.decode(plaintext)).entries), revision: record.content.data }; }
    finally { plaintext.fill(0); }
  } finally { raw.fill(0); }
}
export function hasVault(storage = storageDefault()) { return Boolean(storage.getItem(VAULT_STORAGE_KEY)); }
export async function createVault(passphrase, storage = storageDefault()) {
  if (hasVault(storage)) throw new Error('A vault already exists. Unlock it or restore a backup.');
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a passphrase between 12 and 1,024 characters.');
  const salt = b64(bytes(16)), raw = bytes(32);
  try {
    const key = await importKey(raw);
    const record = { version: 1, kdf: { salt, iterations: ITERATIONS }, wrappedKey: await seal(await wrappingKey(passphrase, salt), raw), content: await contentBox(key, []) };
    if (hasVault(storage)) throw new Error('A vault was created in another window. Unlock it instead.');
    storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
    return { key, entries: [], revision: record.content.data };
  } finally { raw.fill(0); }
}
export async function unlockVault(passphrase, storage = storageDefault()) {
  const record = readRecord(storage);
  try { return await sessionFromRaw(await open(await wrappingKey(String(passphrase), record.kdf.salt), record.wrappedKey), record); }
  catch { throw new Error('The passphrase is incorrect or the vault could not be verified.'); }
}
export async function saveEntries(session, entries, storage = storageDefault()) {
  if (!session?.key) throw new Error('Unlock your vault first.');
  const record = readRecord(storage);
  if (session.revision !== record.content.data) throw new Error('This vault changed in another window. Lock and unlock it before saving.');
  // Confirm this session still belongs to the stored vault before replacing it.
  const previous = await open(session.key, record.content); previous.fill(0);
  const normalized = cleanEntries(entries);
  const content = await contentBox(session.key, normalized);
  const latest = readRecord(storage);
  if (latest.content.data !== record.content.data) throw new Error('This vault changed in another window. Lock and unlock it before saving.');
  latest.content = content;
  storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(latest));
  return { key: session.key, entries: normalized, revision: content.data };
}
export function exportEncryptedVault(storage = storageDefault()) { return JSON.stringify(readRecord(storage), null, 2); }
export async function restoreEncryptedVault(text, passphrase, storage = storageDefault()) {
  const previousRecord = storage.getItem(VAULT_STORAGE_KEY);
  const record = parseRecord(text);
  let session;
  try { session = await sessionFromRaw(await open(await wrappingKey(String(passphrase), record.kdf.salt), record.wrappedKey), record); }
  catch { throw new Error('The backup passphrase is incorrect or the backup could not be verified. Your current vault has not changed.'); }
  if (storage.getItem(VAULT_STORAGE_KEY) !== previousRecord) throw new Error('The current vault changed while verifying the backup. Review it before restoring.');
  storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  return session;
}

function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Invalid CSV quoting.');
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); if (row.some(value => value.length)) rows.push(row); row = []; field = '';
    } else field += char;
    if (rows.length > MAX_ENTRIES + 1) throw new Error('Import up to 1,000 passwords at a time.');
  }
  if (quoted) throw new Error('An imported CSV field is missing its closing quote.');
  row.push(field); if (row.some(value => value.length)) rows.push(row);
  return rows;
}
export function parsePasswordImport(text, fileName = '') {
  if (typeof text !== 'string' || encoder.encode(text).length > MAX_TEXT) throw new Error('Choose a password export smaller than 2 MB.');
  text = text.replace(/^\uFEFF/, '');
  let entries;
  if (/\.json$/i.test(fileName) || /^[\s]*[\[{]/.test(text)) {
    let value; try { value = JSON.parse(text); } catch { throw new Error('This JSON password export could not be read.'); }
    if (value?.encrypted === true || value?.version === 1) throw new Error('Use Restore encrypted backup for an encrypted vault.');
    const items = Array.isArray(value) ? value : value?.items || value?.entries;
    if (!Array.isArray(items)) throw new Error('No password entries were found in this export.');
    entries = items.filter(item => item?.type == null || item.type === 1).map(item => ({
      name: item.name || item.title || '', url: item.url || item.login?.uris?.[0]?.uri || '',
      username: item.username || item.login?.username || '', password: item.password || item.login?.password || '', notes: item.notes || '',
    }));
  } else {
    const [headers, ...rows] = csvRows(text);
    if (!headers) throw new Error('The password export is empty.');
    const normalized = headers.map(header => header.trim().toLowerCase().replace(/[ _-]/g, ''));
    const aliases = { name: ['name', 'title'], url: ['url', 'website', 'loginuri'], username: ['username', 'loginusername', 'login', 'email'], password: ['password', 'loginpassword'], notes: ['notes', 'note', 'extra'] };
    if (!normalized.some(header => aliases.password.includes(header))) throw new Error('The CSV must contain a password column.');
    entries = rows.map(row => Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, row[normalized.findIndex(header => names.includes(header))] || ''])));
  }
  if (!entries.length) throw new Error('No password entries were found in this export.');
  return cleanEntries(entries);
}

async function deviceKey(secret) {
  const raw = new Uint8Array(secret);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: aad, info: encoder.encode('device wrapping key') }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { raw.fill(0); }
}
function deviceSupport() {
  if (!globalThis.isSecureContext || !globalThis.PublicKeyCredential || !navigator.credentials) throw new Error('Device unlock needs a secure browser with passkey encryption support. Use your passphrase here.');
}
export function hasDeviceUnlock(storage = storageDefault()) {
  try { return Boolean(readRecord(storage).device); } catch { return false; }
}
export async function enableDeviceUnlock(passphrase, storage = storageDefault()) {
  deviceSupport();
  const record = readRecord(storage);
  let raw;
  try { raw = await open(await wrappingKey(String(passphrase), record.kdf.salt), record.wrappedKey); }
  catch { throw new Error('Confirm the correct vault passphrase first.'); }
  try {
    const salt = bytes(32);
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: bytes(32), rp: { name: 'UFIconnect Vault' },
      user: { id: bytes(32), name: 'browser-vault', displayName: 'Your browser vault' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      timeout: 60000, attestation: 'none', extensions: { prf: { eval: { first: salt } } },
    } });
    if (!credential) throw new Error('Device setup was cancelled.');
    let output = credential.getClientExtensionResults()?.prf?.results?.first;
    if (!output && credential.getClientExtensionResults()?.prf?.enabled) {
      const assertion = await navigator.credentials.get({ publicKey: { challenge: bytes(32), userVerification: 'required', timeout: 60000,
        allowCredentials: [{ id: credential.rawId, type: 'public-key', transports: ['internal'] }], extensions: { prf: { eval: { first: salt } } } } });
      output = assertion?.getClientExtensionResults()?.prf?.results?.first;
    }
    if (!output) throw new Error('This passkey cannot encrypt a vault. Keep using your passphrase on this device.');
    const device = { id: b64(credential.rawId), salt: b64(salt), wrappedKey: await seal(await deviceKey(output), raw) };
    const latest = readRecord(storage);
    if (latest.wrappedKey.data !== record.wrappedKey.data || latest.kdf.salt !== record.kdf.salt) throw new Error('The vault was replaced during device setup. Unlock it and try again.');
    latest.device = device;
    storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(latest));
  } finally { raw.fill(0); }
}
export async function unlockWithDevice(storage = storageDefault()) {
  deviceSupport();
  const record = readRecord(storage);
  if (!record.device) throw new Error('Unlock with your passphrase, then set up device unlock.');
  const assertion = await navigator.credentials.get({ publicKey: { challenge: bytes(32), userVerification: 'required', timeout: 60000,
    allowCredentials: [{ id: un64(record.device.id), type: 'public-key', transports: ['internal'] }],
    extensions: { prf: { eval: { first: un64(record.device.salt) } } } } });
  const output = assertion?.getClientExtensionResults()?.prf?.results?.first;
  if (!output) throw new Error('Device verification did not provide an encryption key. Use your passphrase.');
  try { return await sessionFromRaw(await open(await deviceKey(output), record.device.wrappedKey), record); }
  catch { throw new Error('Device unlock could not verify this vault. Use your passphrase.'); }
}
