// Reporting only: source estimates are never converted into provider views,
// platform revenue shares, payable balances or payment instructions.
const SCALE = 1000000n;
const MAX_ROWS = 500;
const fallbackCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'INR', 'BRL', 'MXN', 'KRW', 'KWD', 'BHD'];
export const earningsCurrencies = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : fallbackCurrencies;

function money(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text)) throw Error('Enter a nonnegative amount with up to 6 decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
function decimal(value) {
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Use a valid reporting date.');
  return value;
}
function accountUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw Error('Enter the original creator account HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 || !url.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw Error('Enter a public creator account HTTPS URL without credentials.');
  url.hash = ''; url.search = '';
  return url.href.replace(/\/$/, '');
}
export function validateEarningsEntry(input, sourceIds, today = new Date().toISOString().slice(0, 10)) {
  if (!sourceIds.includes(input?.source)) throw Error('Choose an available source.');
  const currency = String(input.currency || '').toUpperCase();
  if (!earningsCurrencies.includes(currency)) throw Error('Choose a supported currency.');
  const startDate = date(input.startDate), endDate = date(input.endDate);
  if (endDate < startDate || endDate > today) throw Error('Reporting dates must be in order and cannot be in the future.');
  const reference = String(input.reference || '').trim();
  if (!reference || reference.length > 160 || /[\u0000-\u001f]/.test(reference)) throw Error('Enter the statement reference (up to 160 characters).');
  return { source: input.source, creatorAccount: accountUrl(input.creatorAccount), currency, amount: decimal(money(input.amount)),
    startDate, endDate, reference, provenance: 'manual_unverified', scope: 'creator_account', paymentStatus: 'not_a_payout' };
}
function overlaps(a, b) {
  return a.source === b.source && a.creatorAccount === b.creatorAccount && a.currency === b.currency
    && a.startDate <= b.endDate && b.startDate <= a.endDate;
}
export function addEarningsEntry(records, entry) {
  if (records.length >= MAX_ROWS) throw Error(`Keep up to ${MAX_ROWS} statement entries per report.`);
  if (records.some(row => overlaps(row, entry))) throw Error('This account already has an overlapping report in that currency. Remove the earlier entry before adding a replacement.');
  return [...records, entry];
}
export function providerEarningsRecords(sources) {
  return sources.flatMap(source => {
    const r = source.revenue;
    if (!source.connected || source.status !== 'available' || r?.status !== 'estimated' || typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount < 0) return [];
    try {
      const record = validateEarningsEntry({ source: source.id, creatorAccount: source.originalUrl, amount: r.amount.toFixed(6), currency: r.currency,
        startDate: r.startDate, endDate: r.endDate, reference: `API ${source.id}: ${r.startDate}/${r.endDate}` }, [source.id]);
      return [{ ...record, provenance: 'provider_estimate', fetchedAt: source.lastSyncedAt || null }];
    } catch { return []; } // Missing amount, account or period is unavailable, never zero.
  });
}
export function generateEarningsReport(sources, manualEntries, now = new Date()) {
  const sourceIds = sources.map(source => source.id);
  if (manualEntries.length > MAX_ROWS) throw Error(`Keep up to ${MAX_ROWS} statement entries per report.`);
  const verified = providerEarningsRecords(sources);
  let accepted = [...verified];
  const excluded = [];
  for (const input of manualEntries) {
    const row = validateEarningsEntry(input, sourceIds, now.toISOString().slice(0, 10));
    if (accepted.some(old => overlaps(old, row))) excluded.push({ ...row, exclusion: 'overlapping_report' });
    else accepted.push(row);
  }
  const totals = new Map();
  for (const row of accepted) {
    const key = JSON.stringify([row.source, row.creatorAccount, row.currency, row.provenance]);
    const previous = totals.get(key);
    totals.set(key, { source: row.source, creatorAccount: row.creatorAccount, currency: row.currency, provenance: row.provenance,
      value: (previous?.value || 0n) + money(row.amount) });
  }
  return { schemaVersion: 1, generatedAt: now.toISOString(), kind: 'source_earnings_report',
    notice: 'Creator account reports, not revenue earned by individual playback in UFI. Manual entries are unverified. Provider payouts and platform revenue shares are unavailable. Playback history is separate. No money is transferred.',
    records: accepted, excluded, totals: [...totals.values()].map(({ value, ...row }) => ({ ...row, amount: decimal(value) })),
    sourceStatus: sources.map(source => ({ source: source.id, status: verified.some(row => row.source === source.id) ? 'provider_estimate_available' : 'not_reported' })),
    ufiPayments: { status: 'not_configured', pending: null, available: null, paid: null } };
}

export function earningsCsv(report) {
  const columns = ['source', 'creatorAccount', 'currency', 'amount', 'startDate', 'endDate', 'reference', 'provenance', 'scope', 'paymentStatus'];
  const cell = value => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return [columns, ...report.records.map(row => columns.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n');
}
