// Read-only, public guides. Only catalog slugs can reach the provider.
// Text excerpts are rendered as text by the client, never as provider HTML.
function guideSections(extract) {
  if (typeof extract !== 'string' || !extract.trim()) throw new Error('Empty guide');
  const sections = [];
  let heading = 'Overview', lines = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text && sections.length < 80) sections.push({ heading: heading.slice(0,160), text: text.slice(0,4000) });
    lines = [];
  };
  for (const line of extract.slice(0,300000).split('\n')) {
    const title = line.match(/^={2,6}\s*(.*?)\s*={2,6}$/);
    if (title) { flush(); heading = title[1]; } else lines.push(line);
  }
  flush();
  if (!sections.length) throw new Error('Empty guide');
  return sections;
}

function createTravelGuides(destinations, fetchResource, now = Date.now) {
  const catalog = new Map(destinations.map(city => [`${city.countryCode}:${city.slug}`,city]));
  const cache = new Map(), pending = new Map();
  return async id => {
    const city = catalog.get(id);
    if (!city) return null;
    const base = { id, city: city.city, country: city.country,
      overview: city.fallback || `Explore ${city.city}, ${city.country}.`,
      sourceUrl: 'https://en.wikivoyage.org/wiki/' + encodeURIComponent(city.slug),
      historyUrl: 'https://en.wikivoyage.org/w/index.php?title=' + encodeURIComponent(city.slug) + '&action=history',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    const cached = cache.get(id);
    if (cached?.expires > now()) return cached.value;
    if (pending.has(id)) return pending.get(id);
    if (pending.size >= 4) return { ...base, available: false, sections: [], retryable: true };
    const request = Promise.resolve().then(async () => {
      try {
        const query = new URLSearchParams({ action:'query', prop:'extracts', explaintext:'1', exsectionformat:'wiki', titles:city.slug, format:'json', formatversion:'2', redirects:'1' });
        const data = await fetchResource('https://en.wikivoyage.org/w/api.php?' + query, {timeoutMs:7000,maxBytes:2*1024*1024});
        const page = data?.query?.pages?.[0];
        if (!page || page.missing || page.ns !== 0) throw new Error('Guide unavailable');
        const value = { ...base, available:true, stale:false, sections:guideSections(page.extract), fetchedAt:new Date(now()).toISOString() };
        cache.set(id,{value,expires:now()+6*60*60*1000});
        return value;
      } catch {
        const value = cached?.value.available ? { ...cached.value, stale:true }
          : { ...base, available:false, sections:[], retryable:true };
        cache.set(id,{value,expires:now()+30000});
        return value;
      } finally { pending.delete(id); }
    });
    pending.set(id,request);
    return request;
  };
}
module.exports = { guideSections, createTravelGuides };
