export const SNAP_FILTERS = Object.freeze([
  { id: 'original', label: 'Original', css: 'none' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.35) contrast(1.08)' },
  { id: 'warm', label: 'Warm', css: 'sepia(.22) saturate(1.15)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(12deg) saturate(.9)' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1)' },
]);
export const SNAP_MAX_OVERLAY = 80;
export function snapFilterStyle(value) {
  return { filter: SNAP_FILTERS.find(filter => filter.id === value)?.css || 'none' };
}
