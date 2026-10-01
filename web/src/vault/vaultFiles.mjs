// File bytes and metadata are placed inside the existing authenticated vault
// envelope. This module never reads storage, opens files, or performs requests.
export const MAX_VAULT_FILE_BYTES = 512 * 1024;
export const VAULT_FILE_KINDS = ['document', 'key'];
const MAX_ENCODED_BYTES = Math.ceil(MAX_VAULT_FILE_BYTES / 3) * 4;

function fileName(value) {
  if (typeof value !== 'string' || value.length > 1024) throw new Error('The document or key filename is invalid.');
  const name = value.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return name && !/^\.+$/.test(name) ? name : 'vault-file';
}

export function cleanVaultFile(entry) {
  if (!entry || !VAULT_FILE_KINDS.includes(entry.kind)) throw new Error('Choose Documents or Keys for this import.');
  if (!Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_VAULT_FILE_BYTES) throw new Error('Choose a nonempty document or key up to 512 KB.');
  if (typeof entry.data !== 'string' || entry.data.length > MAX_ENCODED_BYTES || entry.data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)) throw new Error('The document or key contents are invalid.');
  const decoded = atob(entry.data);
  if (decoded.length !== entry.size || btoa(decoded) !== entry.data) throw new Error('The document or key size does not match its contents.');
  return { kind: entry.kind, name: fileName(entry.name || entry.fileName), fileName: fileName(entry.fileName), size: entry.size, data: entry.data };
}

export async function importVaultFile(file, kind) {
  if (!VAULT_FILE_KINDS.includes(kind)) throw new Error('Choose Documents or Keys for this import.');
  if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > MAX_VAULT_FILE_BYTES) throw new Error('Choose a nonempty document or key up to 512 KB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (bytes.length !== file.size) throw new Error('The selected file changed. Choose it again.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { id: crypto.randomUUID(), ...cleanVaultFile({ kind, name: file.name, fileName: file.name, size: bytes.length, data: btoa(binary) }) };
  } finally { bytes.fill(0); }
}

export function vaultFileBytes(entry) {
  const clean = cleanVaultFile(entry);
  return Uint8Array.from(atob(clean.data), character => character.charCodeAt(0));
}
