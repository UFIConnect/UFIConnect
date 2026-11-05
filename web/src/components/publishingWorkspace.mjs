import { getNativeRuntime, isNativeRuntime, reportNativeError } from '../nativeRuntime.mjs';

export async function openAccountWorkspace(path) {
  const url = new URL(path, 'https://uficonnect.org');
  if (url.origin !== 'https://uficonnect.org' || url.username || url.password) throw new Error('Invalid account destination.');
  if (!isNativeRuntime()) { window.open(url.pathname + url.search, '_blank', 'noopener,noreferrer'); return; }
  try {
    const host = getNativeRuntime();
    if (typeof host?.onOpenExternal !== 'function') throw new Error('Unavailable');
    await host.onOpenExternal(url.href);
    window.dispatchEvent(new Event('focus'));
  } catch { reportNativeError('The account page could not be opened. Please try again.'); }
}
