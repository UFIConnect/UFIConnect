// Travel requests have a short, absolute deadline; a slow provider must not
// hold a member's entire feed open through several sequential batches.
async function fetchTravelResource(url, { json = true, timeoutMs = 5000, maxBytes, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'UFIconnect/1.0 (https://uficonnect.org)',
      Accept: json ? 'application/json' : 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Travel provider returned HTTP ${response.status}`);
  if (maxBytes) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Travel provider response is too large');
      chunks.push(Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return json ? JSON.parse(text) : text;
  }
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
