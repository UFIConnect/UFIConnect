function normalizeTopicLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizePreferenceTopics(selectedTopics, availableTopics, normalize = normalizeTopicLabel) {
  const canonicalByNormalized = new Map(
    (availableTopics || []).map(topic => [normalize(topic), topic])
  );
  const selected = [];
  const seen = new Set();

  for (const value of selectedTopics || []) {
    const canonical = canonicalByNormalized.get(normalize(value));
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    selected.push(canonical);
  }

  return selected;
}

module.exports = { canonicalizePreferenceTopics, normalizeTopicLabel };
