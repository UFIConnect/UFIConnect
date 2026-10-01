export const VAULT_COMMANDS = ['add', 'import', 'backup', 'web', 'app', 'copy'];
export function safeLaunchUrl(value, app = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    if (url.protocol === 'https:' || (!app && url.protocol === 'http:')) return url.href;
    if (app && /^spotify:(?:track|album|artist|playlist|show|episode):[A-Za-z0-9]{22}$/.test(value)) return value;
    if (app && url.protocol === 'msteams:' && url.hostname === 'teams.microsoft.com' && /^\/l\/(?:entity|app)\//.test(url.pathname)) return url.href;
  } catch { /* Unsupported app links stay inert. */ }
  return '';
}
export function cleanVaultPreferences(value = {}) {
  const favorites = Array.isArray(value?.favorites) ? [...new Set(value.favorites.filter(id => VAULT_COMMANDS.includes(id)))] : ['add', 'import', 'backup'];
  return { favorites, commands: Object.fromEntries(VAULT_COMMANDS.map(id => [id, Number.isSafeInteger(value?.commands?.[id]) ? Math.max(0, Math.min(1000000, value.commands[id])) : 0])) };
}
