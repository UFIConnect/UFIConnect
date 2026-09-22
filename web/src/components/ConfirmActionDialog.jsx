import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConfirmActionDialog.css';

// Native modal dialogs keep keyboard focus and pointer interaction inside the
// confirmation. The portal also keeps these buttons out of their page's form.
export default function ConfirmActionDialog({ title, children, confirmLabel = 'Confirm delete', pendingLabel = 'Deleting…', errorMessage, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    dialog.showModal();
    cancelRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      mounted.current = false;
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  async function confirm() {
    // A ref guards consecutive clicks before React renders disabled buttons.
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await onConfirm();
    } catch (failure) {
      if (mounted.current) setError(failure?.response?.data?.message || errorMessage || 'This action did not finish. Please try again.');
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="confirm-action-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={pending}
      onCancel={event => {
        event.preventDefault();
        if (!submitting.current) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId} className="confirm-action-description">{children}</div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="confirm-action-buttons">
        <button ref={cancelRef} type="button" className="btn btn-ghost" disabled={pending} onClick={() => { if (!submitting.current) onClose(); }}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={pending} onClick={confirm}>{pending ? pendingLabel : confirmLabel}</button>
      </div>
      {pending && <p className="confirm-action-progress" role="status">Please wait for this action to finish.</p>}
    </dialog>,
    document.body,
  );
}
