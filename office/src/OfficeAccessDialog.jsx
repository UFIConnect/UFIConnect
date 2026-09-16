import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

let request = null;
const listeners = new Set();
export function requestOfficeAccess() {
  if (request) return request.promise;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  request = { promise, resolve };
  listeners.forEach(listener => listener(true));
  return promise;
}

export default function OfficeAccessDialog() {
  const [open, setOpen] = useState(Boolean(request));
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const dialog = useRef(null);
  useEffect(() => { listeners.add(setOpen); setOpen(Boolean(request)); return () => listeners.delete(setOpen); }, []);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => {
    // Conceal before pagehide can freeze this document in the browser cache.
    const hide = () => flushSync(() => setVisible(false));
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener('blur', hide);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', hide); window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  function finish(token) {
    const pending = request;
    request = null;
    setValue('');
    setVisible(false);
    setOpen(false);
    dialog.current?.close();
    pending?.resolve(token);
  }
  const protect = event => event.preventDefault();
  return <dialog ref={dialog} aria-labelledby="office-access-title" onCancel={event => { event.preventDefault(); finish(''); }}
    style={{ boxSizing: 'border-box', maxWidth: 420, width: 'calc(100% - 32px)', border: '1px solid #cbd5e1', borderRadius: 12, padding: 24 }}>
    <form onSubmit={event => { event.preventDefault(); finish(value); }}>
      <h2 id="office-access-title">Office access</h2>
      <p>Enter your administrative access token. It stays in this tab until you reload or close it.</p>
      <label htmlFor="office-access-token">Access token</label>
      <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setVisible(false); }}
        style={{ display: 'flex', alignItems: 'stretch', gap: 8, margin: '8px 0 16px' }}>
      <input id="office-access-token" name="office-access-token" type={visible ? 'text' : 'password'} autoComplete="current-password"
        value={value} onChange={event => setValue(event.target.value)} autoFocus required spellCheck={false}
        autoCapitalize="none" onCopy={protect} onCut={protect} onDragStart={protect}
        style={{ display: 'block', boxSizing: 'border-box', width: '100%', minWidth: 0, padding: 10 }} />
      <button type="button" aria-label={visible ? 'Hide access token' : 'Show access token'} aria-pressed={visible}
        aria-controls="office-access-token" disabled={!value} onClick={() => setVisible(current => !current)}
        style={{ padding: '8px 12px', minWidth: 56 }}>{visible ? 'Hide' : 'Show'}</button>
      </div>
      <button type="submit">Unlock Office</button>{' '}
      <button type="button" onClick={() => finish('')}>Cancel</button>
    </form>
  </dialog>;
}
