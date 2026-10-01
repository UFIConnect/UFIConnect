'use strict';

// Experimental, per-account neural reconstruction of native UFI activity.
// No provider metrics, media, credentials, security events, or message text enter
// this model. Its output never grants access or makes copyright decisions.
const FEATURES = ['posts', 'comments', 'actions'];
const MODEL = 'ufi-activity-autoencoder-v1';
function analyzeActivity(daily, { enabled = false, now = Date.now() } = {}) {
  const base = { model: MODEL, experimental: true, insights: [],
    scope: 'Native UFIConnect daily activity only. Informational; not a security or copyright verdict.' };
  if (!enabled) return { ...base, status: 'disabled', reason: 'Enable ACTIVITY_LEARNING_ENABLED to analyze native daily activity locally.' };
  const today = new Date(now).toISOString().slice(0, 10);
  const rows = Array.isArray(daily) ? daily.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && row.day < today
    && FEATURES.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 1000000))
    .sort((a, b) => a.day.localeCompare(b.day)).slice(-30) : [];
  if (new Set(rows.map(row => row.day)).size !== rows.length || rows.length < 22 || rows.slice(0, -1).filter(row => FEATURES.some(key => row[key] > 0)).length < 7) {
    return { ...base, status: 'insufficient_data', reason: 'At least 22 complete days, including 7 active training days, are needed.' };
  }
  for (let i = 1; i < rows.length; i++) {
    if (Date.parse(rows[i].day) - Date.parse(rows[i - 1].day) !== 86400000) return { ...base, status: 'insufficient_data', reason: 'Daily activity history must be complete and consecutive.' };
  }
  const raw = rows.map(row => FEATURES.map(key => Math.log1p(row[key])));
  const history = raw.slice(0, -1);
  const means = FEATURES.map((_, i) => history.reduce((sum, row) => sum + row[i], 0) / history.length);
  const scales = FEATURES.map((_, i) => Math.max(0.25, Math.sqrt(history.reduce((sum, row) => sum + (row[i] - means[i]) ** 2, 0) / history.length)));
  const normalized = raw.map(row => row.map((value, i) => Math.max(-8, Math.min(8, (value - means[i]) / scales[i]))));
  // Three hidden layers; bounded deterministic SGD for reproducible local runs.
  const dimensions = [3, 8, 2, 8, 3];
  let seed = 179;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const layers = dimensions.slice(1).map((width, l) => ({
    weights: Array.from({ length: width }, () => Array.from({ length: dimensions[l] }, () => (random() - .5) * Math.sqrt(6 / dimensions[l]))),
    bias: Array(width).fill(0),
  }));
  function forward(input) {
    const values = [input];
    for (let l = 0; l < layers.length; l++) {
      const { weights, bias } = layers[l];
      values.push(weights.map((w, j) => {
        const sum = bias[j] + w.reduce((total, v, i) => total + v * values[l][i], 0);
        return l === layers.length - 1 ? sum : Math.tanh(sum);
      }));
    }
    return values;
  }
  const train = normalized.slice(0, -1);
  for (let epoch = 0; epoch < 180; epoch++) {
    for (const input of train) {
      const values = forward(input);
      let delta = values.at(-1).map((v, i) => 2 * (v - input[i]) / 3);
      for (let l = layers.length - 1; l >= 0; l--) {
        const layer = layers[l];
        const previous = values[l].map((v, i) => layer.weights.reduce((sum, w, j) => sum + w[i] * delta[j], 0) * (l ? 1 - v * v : 1));
        layer.weights.forEach((w, j) => {
          w.forEach((_, i) => { w[i] -= .008 * Math.max(-5, Math.min(5, delta[j] * values[l][i])); });
          layer.bias[j] -= .008 * Math.max(-5, Math.min(5, delta[j]));
        });
        delta = previous;
      }
    }
  }
  const error = input => forward(input).at(-1).reduce((sum, value, i) => sum + (value - input[i]) ** 2, 0) / 3;
  const errors = train.map(error);
  const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const deviation = Math.sqrt(errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) / errors.length);
  const score = error(normalized.at(-1));
  if (!Number.isFinite(score)) return { ...base, status: 'unavailable', reason: 'The activity model could not produce a finite result.' };
  const unusual = score > Math.max(.75, mean + 3 * deviation);
  return { ...base, status: 'ready', trainedDays: history.length, evaluatedDay: rows.at(-1).day,
    reason: 'A local neural autoencoder compares the last completed day with earlier native activity. This experimental signal has not been independently validated.',
    insights: [{ title: unusual ? 'Activity pattern changed' : 'Activity pattern is within the learned range',
      detail: `${rows.at(-1).day}: ${unusual ? 'Review your recent activity if this change was unexpected.' : 'No unusual reconstruction error was detected.'} This is not evidence of compromise or safety.`,
      severity: unusual ? 'review' : 'info' }] };
}

module.exports = { analyzeActivity, FEATURES, MODEL };
