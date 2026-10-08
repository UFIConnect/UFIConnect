import SOURCE_APPS from '../../../shared/source-apps.json' with { type: 'json' };
import DIRECTORY from '../../../backend/account-directory.json' with { type: 'json' };
import IMPORTED_APPS from '../../../shared/imported-app-actions.json' with { type: 'json' };
import { safeLaunchUrl } from './vaultLaunchers.mjs';
export { SOURCE_APPS, IMPORTED_APPS };
function host(value) { try { return new URL(safeLaunchUrl(value)).hostname.toLowerCase(); } catch { return ''; } }
export function sourceForVaultEntry(entry, platforms = {}) {
  const hosts = [host(entry?.url), host(entry?.appUrl)].filter(Boolean);
  const catalog = { ...DIRECTORY, ...IMPORTED_APPS, ...SOURCE_APPS };
  for (const [key, item] of Object.entries(platforms)) catalog[key] = { ...catalog[key], ...item };
  const candidates = Object.entries(catalog).filter(([, item]) => {
    const roots = [...(item.hosts || []), host(item.siteUrl), host(item.loginUrl)].filter(root => root && !['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com'].includes(root));
    return hosts.some(value => roots.some(root => value === root || value.endsWith('.' + root)));
  });
  if (candidates.length === 1) return candidates[0][0];
  if (hosts.length) return '';
  const name = String(entry?.name || '').trim().toLowerCase();
  const named = Object.entries(catalog).filter(([key, item]) => [key, item.name?.toLowerCase(), item.label?.toLowerCase()].includes(name));
  return named.length === 1 ? named[0][0] : '';
}
export function importedAppActions(entry, source, platform = {}, connected = false, careerOnly = false) {
  const actions = [];
  if (connected && !platform.commandCenterOnly && platform.ownContent?.supported) actions.push({ id: 'feed', label: `${platform.name || IMPORTED_APPS[source]?.label || source} feed`, to: '/?feed=following&source=' + encodeURIComponent(source) });
  if (connected && platform.crossPost?.supported) actions.push({ id: 'publish', label: 'Publish a post', to: careerOnly ? '/career-posts' : '/command-center?tab=crosspost' });
  if (connected && ['reddit', 'bluesky'].includes(source)) actions.push({ id: 'messages', label: 'Messages', to: '/messages' });
  if (connected && ['github', 'reddit', 'bluesky'].includes(source)) actions.push({ id: 'notifications', label: 'Notifications', to: '/notifications' });
  actions.push(...(IMPORTED_APPS[source]?.actions || []));
  if (!actions.length) {
    const url = safeLaunchUrl(entry?.appUrl, true) || safeLaunchUrl(entry?.url);
    if (url) actions.push({ id: 'open', label: `Open ${entry.name}`, url });
  }
  return actions;
}
