import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import './ProfilePhoto.css';

function PhotoDialog({ src, label, onClose }) {
  const dialogRef = useRef(null);
  useLockBodyScroll(true);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} className="profile-photo-dialog" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button type="button" className="profile-photo-close" onClick={onClose} autoFocus aria-label="Close photo">Close</button>
    <img src={src} alt={label} />
  </dialog>, document.body);
}

export default function ProfilePhoto({ src, label, cover = false, children, style }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={cover ? 'profile-photo-open profile-photo-cover' : 'profile-photo-open'}
      style={style} aria-label={'View ' + label} onClick={() => setOpen(true)}>{children}</button>
    {open && <PhotoDialog src={src} label={label} onClose={() => setOpen(false)} />}
  </>;
}

