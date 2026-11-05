export const COMPARISON_METRICS = Object.freeze([
  { key: 'edgeRequests', label: 'Edge requests', group: 'edge', definition: 'Cloudflare requests, including assets, API calls and automated traffic.' },
  { key: 'htmlPageViews', label: 'HTML page views', group: 'edge', definition: 'HTML requests recorded at Cloudflare, including automated traffic.' },
  { key: 'webPageOpens', label: 'Website page opens', group: 'firstParty', definition: 'Recorded website page navigations. Repeated opens count.' },
  { key: 'mobileScreenOpens', label: 'Mobile screen opens', group: 'firstParty', definition: 'Recorded app screen navigations. Repeated opens count.' },
  { key: 'tabOpens', label: 'Tab opens', group: 'firstParty', definition: 'Recorded internal tab selections, separate from pages and screens.' },
  { key: 'diagnostics', label: 'Diagnostics', group: 'firstParty', definition: 'Optional recorded client diagnostic occurrences.' },
  { key: 'registrations', label: 'Known registrations', group: 'registrations', definition: 'Current and recovered registration counts using the earliest retained registration date.' },
]);
export const comparisonCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeAdd = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

export function comparisonDaily(report) {
  if (!validDay(report?.range?.from) || !validDay(report?.range?.to)) return [];
  const length = Math.round((Date.parse(report.range.to) - Date.parse(report.range.from)) / 86400000) + 1;
  if (length < 1 || length > 4000) return [];
  const entries = new Map((report?.daily || []).filter(row => validDay(row.day)).map(row => [row.day, row]));
  return Array.from({ length }, (_, index) => {
    const day = new Date(Date.parse(report.range.from) + index * 86400000).toISOString().slice(0, 10), row = entries.get(day);
    return { day, ...Object.fromEntries(COMPARISON_METRICS.map(metric => [metric.key, comparisonCount(row?.[metric.key])])) };
  });
}

export function aggregateComparison(rows, group = 'day', keys = COMPARISON_METRICS.map(metric => metric.key)) {
  const groups = new Map();
  for (const row of rows) {
    const period = group === 'month' ? row.day.slice(0, 7) : group === 'total' ? 'total' : row.day;
    if (!groups.has(period)) groups.set(period, { period, days: 0, coverage: {}, ...Object.fromEntries(keys.map(key => [key, null])) });
    const target = groups.get(period); target.days++;
    for (const key of keys) {
      target.coverage[key] ||= { observedDays: 0, missingDays: 0 };
      const value = comparisonCount(row[key]);
      if (value === null) target.coverage[key].missingDays++;
      else { target.coverage[key].observedDays++; target[key] = safeAdd(target[key] || 0, value); }
    }
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function selectComparison(report, { start, end, matched = true, group = 'month', leftKey = 'htmlPageViews', rightKey = 'webPageOpens' } = {}) {
  const requested = comparisonDaily(report).filter(row => (!start || row.day >= start) && (!end || row.day <= end));
  const shared = row => comparisonCount(row[leftKey]) !== null && comparisonCount(row[rightKey]) !== null;
  const rows = matched ? requested.filter(shared) : requested;
  return { daily: rows, rows: aggregateComparison(rows, group), requestedDays: requested.length,
    matchedDays: requested.filter(shared).length, selectedDays: rows.length,
    totals: aggregateComparison(rows, 'total')[0] || { period: 'total', days: 0, coverage: {}, ...Object.fromEntries(COMPARISON_METRICS.map(metric => [metric.key, null])) } };
}

export const REQUEST_COUNTERS = Object.freeze(['requests', 'errors', 'clientErrors', 'slowRequests', 'aborted']);
export function selectRequestDays(report, { start, end, role = 'all' } = {}) {
  const source = role === 'all' ? report?.daily : report?.dailyByRole?.filter(row => row.role === role);
  const daily = (source || []).filter(row => validDay(row.day) && (!start || row.day >= start) && (!end || row.day <= end));
  return { daily: aggregateComparison(daily, 'day', REQUEST_COUNTERS),
    totals: aggregateComparison(daily, 'total', REQUEST_COUNTERS)[0] || { days: 0, coverage: {}, ...Object.fromEntries(REQUEST_COUNTERS.map(key => [key, null])) } };
}
