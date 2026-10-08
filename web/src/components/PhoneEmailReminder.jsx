import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MailPlus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { emailReminderKey, needsPhoneEmailReminder, readEmailReminder, saveEmailReminder } from '../auth/phoneEmailReminder.mjs';
import './PhoneEmailReminder.css';

const forbiddenPath = path => /^\/(?:settings|login|register|onboarding|auth|forgot-password|reset-password)(?:\/|$)/.test(path);
const browserStorage = () => { try { return window.localStorage; } catch { return null; } };

export function PhoneEmailReminder({ profile, loading = false, delayMs = 2500 }) {
  const { pathname } = useLocation();
  const heading = useId(), description = useId();
  const [visible, setVisible] = useState(null);
  const eligible = !loading && needsPhoneEmailReminder(profile) && !forbiddenPath(pathname);
  const accountId = profile?.id;
  useEffect(() => {
    let current = true, timer, key;
    setVisible(null);
    if (!eligible) return undefined;
    const storage = browserStorage();
    const changed = event => {
      if (event.key !== key && event.key !== null) return;
      const preference = readEmailReminder(accountId, key, storage);
      if (preference.dismissed || preference.nextAt > Date.now()) { clearTimeout(timer); setVisible(null); }
    };
    window.addEventListener('storage', changed);
    emailReminderKey(accountId).then(result => {
      if (!current) return;
      key = result;
      const preference = readEmailReminder(accountId, key, storage);
      if (preference.dismissed || preference.nextAt > Date.now()) return;
      timer = window.setTimeout(() => {
        if (!current) return;
        const latest = readEmailReminder(accountId, key, storage);
        if (latest.dismissed || latest.nextAt > Date.now()) return;
        // Showing it also snoozes future visits, so a refresh or new session
        // cannot immediately reopen a reminder the person has already seen.
        saveEmailReminder(accountId, key, storage);
        setVisible({ accountId, key });
      }, delayMs);
    });
    return () => { current = false; clearTimeout(timer); window.removeEventListener('storage', changed); };
  }, [accountId, eligible, delayMs]);

  if (!eligible || visible?.accountId !== accountId) return null;
  function close(permanent = false) {
    saveEmailReminder(accountId, visible.key, browserStorage(), Date.now(), permanent);
    setVisible(null);
  }
  return <aside className="phone-email-reminder" role="dialog" aria-modal="false" aria-labelledby={heading} aria-describedby={description}>
    <button className="phone-email-reminder-close" type="button" aria-label="Dismiss email reminder" onClick={() => close()}><X size={18} aria-hidden="true" /></button>
    <span className="phone-email-reminder-icon"><MailPlus size={22} aria-hidden="true" /></span>
    <h2 id={heading}>Add an email address</h2>
    <p id={description}>Add a verified email to your account when you're ready. It is optional; you can continue using your phone to sign in without an email or password.</p>
    <div className="phone-email-reminder-actions"><Link className="btn btn-primary" to="/settings?tab=account#email" onClick={() => close()}>Add email in Settings</Link><button className="btn btn-ghost" type="button" onClick={() => close()}>Not now</button></div>
    <button className="phone-email-reminder-stop" type="button" onClick={() => close(true)}>Don't remind me again</button>
  </aside>;
}

export default function AccountEmailReminder() {
  const { profile, loading, token } = useAuth();
  return <PhoneEmailReminder profile={token ? profile : null} loading={loading} />;
}
