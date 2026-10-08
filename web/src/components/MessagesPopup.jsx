import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import './MessagesPopup.css';

const Messages = lazy(() => import('../pages/Messages'));

export default function MessagesPopup({ onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector('button')?.focus({ preventScroll: true }));
    function handleKeys(event) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      // A new-message search may open inside the inbox. Keep its keyboard
      // focus within that inner dialog until it closes.
      const scope = dialog?.querySelector('[role="dialog"]') || dialog;
      const items = [...(scope?.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])]
        .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handleKeys);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeys);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <div className="messages-popup-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section id="messages-popup" className="messages-popup" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="messages-popup-title">
      <div className="messages-popup-heading">
        <h2 id="messages-popup-title">Messages</h2>
        <button type="button" className="messages-popup-close" aria-label="Close messages" onClick={onClose}><X size={19} aria-hidden="true" /></button>
      </div>
      <div className="messages-popup-content">
        <Suspense fallback={<div className="inbox-state" role="status">Loading messages…</div>}><Messages embedded /></Suspense>
      </div>
      <div className="messages-popup-footer"><Link to="/messages" className="btn btn-primary btn-sm" onClick={onClose}>Open inbox</Link></div>
    </section>
  </div>;
}
