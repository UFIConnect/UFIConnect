export const EMAIL_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const memoryPreferences = new Map();
const PREFIX = 'uficonnect.email-reminder.v1.';

export function needsPhoneEmailReminder(profile) {
  return Boolean(profile?.id && profile.authProvider === 'phone' && profile.hasEmail === false
    && !String(profile.email || '').trim() && profile.onboardingComplete === true);
}

export async function emailReminderKey(accountId, cryptoProvider = globalThis.crypto) {
  if (!accountId || !cryptoProvider?.subtle) return null;
  try {
    const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(PREFIX + accountId));
    return PREFIX + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export function readEmailReminder(accountId, key, storage) {
  let value = memoryPreferences.get(accountId) || null;
  try { if (key) value = JSON.parse(storage?.getItem(key) || 'null') || value; } catch { /* Storage can be disabled. */ }
  return value?.version === 1 && typeof value.dismissed === 'boolean' && Number.isFinite(value.nextAt) && value.nextAt >= 0
    ? value : { version: 1, dismissed: false, nextAt: 0 };
}

export function saveEmailReminder(accountId, key, storage, now = Date.now(), dismissed = false) {
  // Store only a reminder preference. Phone numbers, emails, session tokens
  // and raw account identifiers never enter persistent browser storage.
  const value = { version: 1, dismissed, nextAt: now + EMAIL_REMINDER_SNOOZE_MS };
  memoryPreferences.set(accountId, value);
  try { if (key) storage?.setItem(key, JSON.stringify(value)); } catch { /* The in-memory preference still prevents repeat prompts. */ }
  return value;
}
