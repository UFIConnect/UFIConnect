import { useState } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import BirthDateField from './BirthDateField';

export default function BirthDateForm({ onboarding = false }) {
  const { updateProfileLocally, logout } = useAuth();
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy || !birthDate) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post('/profile/birth-date', { birthDate });
      updateProfileLocally(data);
      setBirthDate('');
    } catch (failure) {
      setError(failure.response?.data?.message || 'We could not save your date of birth. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit}>
    <p>We use your date of birth to apply age restrictions. It stays private.</p>
    <BirthDateField value={birthDate} disabled={busy} onChange={event => {
      setBirthDate(event.target.value);
      setError('');
    }} />
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="btn btn-primary" disabled={busy} type="submit">{onboarding ? 'Continue' : 'Save date of birth'}</button>
    {onboarding && <button className="btn btn-ghost" disabled={busy} type="button" onClick={() => logout()}>Sign out</button>}
  </form>;
}
