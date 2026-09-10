// Travel requests have a short, absolute deadline; a slow provider must not
// hold a member's entire feed open through several sequential batches.
async function fetchTravelResource(url, { json = true, timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'UFIconnect/1.0 (https://uficonnect.org)',
      Accept: json ? 'application/json' : 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Travel provider returned HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function normalizeTravelText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mentionsTravelPlace(text, place) {
  const term = normalizeTravelText(place);
  return Boolean(term && ` ${normalizeTravelText(text)} `.includes(` ${term} `));
}

module.exports = { fetchTravelResource, mentionsTravelPlace };
