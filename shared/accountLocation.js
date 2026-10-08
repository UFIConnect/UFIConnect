// Location is an additional view of the authoritative account catalog. It
// never replaces provider categories, connection permissions or website URLs.
const text = value => typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 120) : '';

export function normalizeAccountLocationReport(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.platformIds)
    || !['recent_local_activity', 'local_relevance'].includes(value.basis)) return null;
  const context = value.locationContext && typeof value.locationContext === 'object' ? value.locationContext : {};
  const platformIds = [...new Set(value.platformIds.filter(id => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id)))].slice(0, 250);
  const activityCounts = Object.fromEntries(platformIds.flatMap(id => {
    const count = value.activityCounts?.[id];
    return Number.isSafeInteger(count) && count >= 0 ? [[id, count]] : [];
  }));
  return { platformIds, basis: value.basis, windowDays: Number.isSafeInteger(value.windowDays) && value.windowDays > 0 && value.windowDays <= 30 ? value.windowDays : 7,
    careerOnly: value.careerOnly === true, activityCounts,
    locationContext: { available: context.available === true, city: text(context.city), region: text(context.region),
      country: text(context.country), countryName: text(context.countryName), approximate: context.approximate === true } };
}

export function locationAccountSection(entries, report, { business = false } = {}) {
  const allowed = new Map(entries.filter(([id, platform]) => !business || id === 'linkedin' || platform?.category === 'career'));
  const items = (report?.platformIds || []).filter(id => allowed.has(id)).map(id => [id, allowed.get(id)]);
  return { id: 'location', label: 'Location based', total: items.length, showCount: Boolean(report), items };
}

export function accountLocationCityLabel(report) {
  const context = report?.locationContext;
  if (!context?.city) return 'Unavailable';
  return [...new Set([context.city, context.region, context.countryName || context.country].filter(Boolean))].join(', ');
}

export function accountLocationBasisLabel(report) {
  if (!report) return '';
  return report.basis === 'recent_local_activity'
    ? `Ranked by recent public posts near this city in the last ${report.windowDays} days. Other locally relevant sources follow.`
    : report.locationContext?.city
      ? 'Sources with services relevant to this area. City popularity data is not available yet.'
      : 'Local service suggestions. City popularity data is not available yet.';
}
