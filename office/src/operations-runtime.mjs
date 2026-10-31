export async function readOperation(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false || body.available === false) throw new Error(body.message || body.error || body.msg || `Request failed (${response.status}).`);
  return body;
}
export function safeSourceUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export const operationNumber = value => value == null ? '—' : Number(value).toLocaleString();
export const operationDate = value => value ? new Date(value).toLocaleString() : 'Not recorded';
