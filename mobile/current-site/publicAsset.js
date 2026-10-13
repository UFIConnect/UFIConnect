// Expo inlines a relative base for the bundled native document and the hosting
// base for browser exports. Desktop downloads stay on the public website.
export function publicAsset(value) {
  if (value.startsWith('/downloads/')) return `https://uficonnect.org${value}`;
  const base = process.env.EXPO_BASE_URL || '/';
  return `${base.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
}
