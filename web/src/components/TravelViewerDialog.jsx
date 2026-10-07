import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import './TravelGuideDialog.css';

export default function TravelViewerDialog({ children, onClose }) {
  const dialogRef = useRef(null), closeRef = useRef(null), titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.showModal(); closeRef.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, []);
  return createPortal(<dialog ref={dialogRef} className="travel-viewer-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>Live Travel</h2><button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}><ArrowLeft size={17} />Back to Travel feed</button></header>
    {children}
  </dialog>, document.body);
}
