import { getNativeRuntime } from './nativeRuntime.mjs';
import { officialTwitchClipUrl } from './utils/sourceMediaPolicy.mjs';

export async function openNativeTwitchPlayer({ url, title, creator } = {}) {
  const host = getNativeRuntime();
  const canonical = officialTwitchClipUrl(url);
  if (!canonical) throw new Error('This Twitch clip is unavailable.');
  if (typeof host?.onTwitchPlayer !== 'function') throw new Error('Update UFIconnect to use its Twitch player.');
  const text = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) : '';
  return host.onTwitchPlayer({ url: canonical, title: text(title, 200), creator: text(creator, 100) });
}
