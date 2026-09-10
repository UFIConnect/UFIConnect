export function postedDate(iso) {
  if (!iso) return 'Posting date unavailable';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) return 'Posting date unavailable';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
