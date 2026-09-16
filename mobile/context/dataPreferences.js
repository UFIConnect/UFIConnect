const PREFERENCES_KEY = 'uficonnect.app.preferences.v1';
const DEFAULT_PREFERENCES = Object.freeze({ dataSaver: false, autoplayPreviews: true, performanceInsights: false });

function sanitizePreferences(value) {
  const result = { ...DEFAULT_PREFERENCES };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(result)) if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  return result;
}

function parsePreferences(raw) {
  try { return sanitizePreferences(JSON.parse(raw)); } catch { return { ...DEFAULT_PREFERENCES }; }
}

function feedSections(dataSaver, activeTab) {
  const sections = ['groups', 'social', 'jobs'];
  return dataSaver ? [sections.includes(activeTab) ? activeTab : 'groups'] : sections;
}

module.exports = { PREFERENCES_KEY, DEFAULT_PREFERENCES, sanitizePreferences, parsePreferences, feedSections };
