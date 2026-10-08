export async function readImportText(file, maxBytes, message) {
  if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > maxBytes || typeof file.text !== 'function') throw new Error(message);
  const text = await file.text();
  // The byte limit also applies to the value handed to the parser. Check it
  // again after reading so a changed file or alternate reader cannot bypass it.
  if (typeof text !== 'string' || text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw new Error(message);
  return text;
}
