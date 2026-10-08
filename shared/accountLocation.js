// Location is an additional view of the authoritative account catalog. It
// never replaces provider categories, connection permissions or website URLs.
const text = value => typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 120) : '';
const validId = value => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/.test(value);

function localSourceWebsite(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f-\u009f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith('.local')) return null;
    return url.href;
  } catch { return null; }
}

function localSource(source) {
  if (!source || typeof source !== 'object' || !validId(source.id)) return null;
  const area = source.localArea || {};
  const localArea = ['city', 'region'].includes(area.scope) && text(area.label) ? { label: text(area.label), scope: area.scope } : null;
  return { id: source.id, name: text(source.name), description: text(source.description),
    category: source.category === 'career' ? 'career' : 'publication', siteUrl: localSourceWebsite(source.siteUrl), localArea,
    color: 'var(--primary)', loginUrl: null, connectionMode: 'external', configured: false, connected: false,
    authorizationSupported: false, authorizationAvailable: false,
    feed: { home: false, following: null }, crossPost: { supported: false }, ownContent: { supported: false },
    note: 'Open this source on its official website. Account integration is unavailable.' };
}

export function normalizeAccountLocationReport(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.platformIds)
    || value.basis !== 'local_sources_and_platforms' || (value.localSources !== undefined && !Array.isArray(value.localSources))) return null;
  const context = value.locationContext && typeof value.locationContext === 'object' ? value.locationContext : {};
  const platformIds = [...new Set(value.platformIds.filter(validId))].slice(0, 250);
  const localSources = (value.localSources || []).slice(0, 250).map(localSource).filter(Boolean);
  return { platformIds, localSources, basis: value.basis, careerOnly: value.careerOnly === true,
    locationContext: { available: context.available === true, city: text(context.city), region: text(context.region),
      country: text(context.country), countryName: text(context.countryName), approximate: context.approximate === true } };
}

export function locationAccountSection(entries, report, { business = false } = {}) {
  const catalogIds = new Set(entries.map(([id]) => id));
  const allowed = new Map(entries.filter(([id, platform]) => !business || id === 'linkedin' || platform?.category === 'career'));
  const seen = new Set();
  const localItems = (report?.localSources || []).flatMap(value => {
    // A local record cannot relabel an existing platform or add an OAuth client.
    const platform = localSource(value);
    if (!platform || catalogIds.has(platform.id) || seen.has(platform.id) || !platform.id.startsWith('local_')
      || !platform.name || !platform.siteUrl || !platform.localArea || (business && platform.category !== 'career')) return [];
    seen.add(platform.id);
    return [[platform.id, platform]];
  });
  const popularItems = (report?.platformIds || []).flatMap(id => {
    if (!allowed.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [[id, allowed.get(id)]];
  });
  const items = [...localItems, ...popularItems];
  const groups = report ? [
    { id: 'local', label: 'Local sources', items: localItems, emptyMessage: 'No city or regional sources are available for this location yet.' },
    { id: 'popular', label: 'Popular platforms', items: popularItems, emptyMessage: 'No matching platforms are available in this account catalog.' },
  ] : null;
  return { id: 'location', label: 'Location based', total: items.length, showCount: Boolean(report), items, groups };
}

export function accountLocationCityLabel(report) {
  const context = report?.locationContext;
  if (!context?.city) return 'Unavailable';
  return [...new Set([context.city, context.region, context.countryName || context.country].filter(Boolean))].join(', ');
}

export function accountLocationBasisLabel(report) {
  if (!report) return '';
  return report.locationContext?.city
    ? 'Local sources and well-known platforms. Source location is shown on each local listing.'
    : 'Well-known platforms, with regional sources where location is available. City-specific coverage is unavailable.';
}

export function accountLocalSourceLabel(platform) {
  const area = platform?.localArea;
  return area ? `${area.label} · ${area.scope === 'city' ? 'City source' : 'Regional source'}` : '';
}
