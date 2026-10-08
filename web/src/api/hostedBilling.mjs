export function hostedBillingUrl(value, kind = 'checkout') {
  const url = new URL(value);
  const expected = kind === 'portal' ? 'billing.stripe.com' : 'checkout.stripe.com';
  if (url.protocol !== 'https:' || url.hostname !== expected || url.port || url.username || url.password) {
    throw new Error('The secure billing link was not valid. Please try again.');
  }
  return url.href;
}

// Capture the current route when billing opens. Invalid or unavailable routes
// are omitted so the API can use its existing membership-specific fallback.
export function billingReturnPath(currentLocation = globalThis.window?.location) {
  if (!currentLocation || typeof currentLocation.pathname !== 'string') return undefined;
  const { pathname, search = '', hash = '' } = currentLocation;
  if (!pathname.startsWith('/') || pathname.startsWith('//')
    || typeof search !== 'string' || (search && !search.startsWith('?'))
    || typeof hash !== 'string' || (hash && !hash.startsWith('#'))) return undefined;
  const value = pathname + search + hash;
  if (value.length > 2048 || /[\\\u0000-\u0020]/.test(value)) return undefined;
  let decoded = value;
  for (;;) {
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f-\u009f]/u.test(decoded)) return undefined;
    let next;
    try { next = decodeURIComponent(decoded); } catch { break; }
    if (next === decoded) break;
    decoded = next;
  }
  try {
    const target = new URL(value, 'https://billing-return.invalid');
    if (target.origin !== 'https://billing-return.invalid' || target.pathname.startsWith('//')) return undefined;
    const path = target.pathname + target.search + target.hash;
    return path.length <= 2048 ? path : undefined;
  } catch { return undefined; }
}

// The return marker requests a fresh server check; it never grants access.
// Remove that marker without dropping the tab, other query fields or anchor.
export function billingReturnState(currentLocation = globalThis.window?.location) {
  const path = billingReturnPath(currentLocation);
  if (!path) return { result: null, hasMarker: false, returnPath: undefined };
  const target = new URL(path, 'https://billing-return.invalid');
  const hasMarker = target.searchParams.has('upgrade');
  const value = target.searchParams.get('upgrade');
  const result = ['success', 'cancelled'].includes(value) ? value : null;
  if (hasMarker) target.searchParams.delete('upgrade');
  return { result, hasMarker, returnPath: target.pathname + target.search + target.hash };
}
