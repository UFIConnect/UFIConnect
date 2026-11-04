export const DEFAULT_PIP_TONE = 'friendly';
export const PIP_TONE_STORAGE_KEY = 'uficonnect.pip.tone';

export const PIP_TONES = Object.freeze([
  { id: 'friendly', label: 'Friendly', description: 'Warm, clear, and encouraging.', speech: { rate: 1, pitch: 1.08 } },
  { id: 'calm', label: 'Calm', description: 'Gentle, steady, and easy to follow.', speech: { rate: .9, pitch: .96 } },
  { id: 'playful', label: 'Playful', description: 'Light, curious, and a little whimsical.', speech: { rate: 1.04, pitch: 1.16 } },
  { id: 'professional', label: 'Professional', description: 'Direct, precise, and composed.', speech: { rate: 1, pitch: 1 } },
].map(tone => Object.freeze({ ...tone, speech: Object.freeze(tone.speech) })));

export function getPipTone(id) {
  return PIP_TONES.find(tone => tone.id === id) || PIP_TONES[0];
}

// This preference contains only the preset ID. Storage can be unavailable in
// private browsing or embedded Office views; that must not interrupt the chat.
export function loadPipTone(storage) {
  try { return getPipTone((storage ?? globalThis.localStorage)?.getItem(PIP_TONE_STORAGE_KEY)).id; }
  catch { return DEFAULT_PIP_TONE; }
}

export function savePipTone(id, storage) {
  const selected = getPipTone(id).id;
  try { (storage ?? globalThis.localStorage)?.setItem(PIP_TONE_STORAGE_KEY, selected); } catch { /* Preference remains usable in this tab. */ }
  return selected;
}
