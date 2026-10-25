const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function validDate(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
  } catch { return null; }
}

function calendarDate(date, now, locale) {
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

// Ages use elapsed time. Calendar dates use the viewer's local timezone.
export function formatPostAge(value, { now = Date.now(), locale, style = 'long' } = {}) {
  const date = validDate(value), current = validDate(now);
  if (!date || !current) return '';
  const age = Math.max(0, current.getTime() - date.getTime());
  if (age < MINUTE) return style === 'narrow' ? 'Now' : style === 'short' ? 'just now' : 'Just now';
  const [unit, size] = age >= DAY ? ['day', DAY] : age >= HOUR ? ['hour', HOUR] : ['minute', MINUTE];
  const amount = Math.floor(age / size);
  if (style !== 'long') return `${amount}${unit[0]}${style === 'short' ? ' ago' : ''}`;
  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-amount, unit);
}

export function timeAgo(value, options) { return formatPostAge(value, { ...options, style: 'short' }); }
export function narrowPostAge(value, options) { return formatPostAge(value, { ...options, style: 'narrow' }); }

// Preserve the source's latest edit and exact accessible timestamp.
export function postTimes(post, { now = Date.now(), locale } = {}) {
  const created = validDate(post?.createdAt || post?.time), current = validDate(now);
  if (!created || !current) return null;
  const editedAt = validDate(post?.editedAt);
  const edited = Boolean(editedAt && editedAt.getTime() - created.getTime() > MINUTE);
  const latest = edited ? editedAt : created;
  const yesterday = new Date(current);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = latest.toDateString() === current.toDateString() ? 'Today'
    : latest.toDateString() === yesterday.toDateString() ? 'Yesterday' : calendarDate(latest, current, locale);
  const time = latest.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const full = latest.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' });
  return { day, time, relative: formatPostAge(latest, { now: current, locale }), edited,
    iso: latest.toISOString(), full: `${edited ? 'Edited' : 'Posted'} ${full}` };
}
