import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Camera, Images } from 'lucide-react';
import { getNativeRuntime } from '../nativeRuntime.mjs';
import { MEDIA_PERMISSION_REQUEST, readMediaPermissions, saveMediaPermission } from '../utils/mediaPermissions.mjs';
import './MediaPermissionPrompt.css';

export default function MediaPermissionPrompt({ accountId }) {
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const permittedClick = useRef(new WeakSet());
  const dialog = useRef(null);
  const current = useRef(null);
  const opening = useRef(null);
  const scope = useRef(accountId || 'guest');
  const titleId = useId(), descriptionId = useId();
  const { key: routeKey } = useLocation();
  current.current = request;
  scope.current = accountId || 'guest';
  useEffect(() => {
    const replace = pending => {
      current.current?.respond?.(false);
      current.current = pending;
      setError(''); setBusy(false); setRequest(pending);
    };
    const ask = event => {
      const input = event.target;
      if (!(input instanceof window.HTMLInputElement) || input.type !== 'file' || input.disabled) return;
      if (permittedClick.current.delete(input)) return;
      if (!input.hasAttribute('capture') && !/(?:image|video)\/|\.(?:jpe?g|png|gif|webp|heic|mp4|mov)\b/i.test(input.accept)) return;
      const camera = input.hasAttribute('capture');
      const choice = readMediaPermissions(scope.current)[camera ? 'camera' : 'photos'];
      if (choice === 'allow' && (!camera || !getNativeRuntime()?.onRequestMediaPermission)) return;
      event.preventDefault(); event.stopPropagation();
      replace({ input, camera, opener: document.activeElement, scope: scope.current, mode: choice === 'allow' ? 'opening' : choice === 'block' ? 'blocked' : 'ask' });
    };
    const capture = event => {
      const pending = event.detail;
      if (!pending || pending.accountId !== scope.current || pending.signal?.aborted || typeof pending.respond !== 'function' || !['camera', 'photos'].includes(pending.kind)) return;
      event.preventDefault();
      const choice = readMediaPermissions(scope.current)[pending.kind];
      if (choice === 'allow') { pending.respond(true); return; }
      replace({ ...pending, camera: pending.kind === 'camera', scope: scope.current, mode: choice === 'block' ? 'blocked' : 'ask' });
    };
    document.addEventListener('click', ask, true);
    window.addEventListener(MEDIA_PERMISSION_REQUEST, capture);
    return () => { document.removeEventListener('click', ask, true); window.removeEventListener(MEDIA_PERMISSION_REQUEST, capture); current.current?.respond?.(false); };
  }, []);
  useEffect(() => { current.current?.respond?.(false); current.current = null; setRequest(null); }, [routeKey, accountId]);
  useEffect(() => {
    if (!request) return undefined;
    const aborted = () => { if (current.current === request) cancel(); };
    if (request.signal?.aborted) { aborted(); return undefined; }
    request.signal?.addEventListener('abort', aborted, { once: true });
    dialog.current?.showModal();
    if (request.mode === 'opening') void openPicker(request, false);
    return () => { request.signal?.removeEventListener('abort', aborted); if (request.opener?.isConnected) request.opener.focus(); };
  }, [request]);
  function finish(allowed = false) { const pending = current.current; current.current = null; dialog.current?.close(); setRequest(null); pending?.respond?.(allowed); }
  function cancel() { finish(); }
  function keepFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length);
    const index = controls.indexOf(document.activeElement);
    if (!controls.length) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
  function decline() {
    const pending = current.current;
    if (pending) saveMediaPermission(pending.scope, pending.camera ? 'camera' : 'photos', 'block');
    cancel();
  }
  async function openPicker(pending, remember = true) {
    const available = () => pending && !pending.signal?.aborted && (pending.input ? pending.input.isConnected && !pending.input.disabled : typeof pending.respond === 'function');
    if (!available() || opening.current === pending || scope.current !== pending.scope) return;
    opening.current = pending;
    setBusy(true); setError('');
    try {
      const native = getNativeRuntime();
      if (pending.camera && native?.onRequestMediaPermission) {
        const granted = await native.onRequestMediaPermission('camera');
        if (!granted) {
          if (current.current === pending && scope.current === pending.scope) {
            saveMediaPermission(pending.scope, 'camera', 'block');
            setError('Camera access was declined. Enable camera access in your device settings, then change your choice here.');
            setRequest({ ...pending, mode: 'blocked' });
          }
          return;
        }
      }
      if (current.current !== pending || scope.current !== pending.scope || !available()) return;
      if (remember) saveMediaPermission(pending.scope, pending.camera ? 'camera' : 'photos', 'allow');
      if (pending.input) { permittedClick.current.add(pending.input); cancel(); pending.input.click(); }
      else finish(true);
    } catch (failure) {
      if (current.current === pending) setError(failure.message || 'The camera could not open. Please try again.');
    } finally { if (opening.current === pending) opening.current = null; if (current.current === pending || !current.current || current.current?.input === pending.input) setBusy(false); }
  }
  if (!request) return null;
  const Icon = request.camera ? Camera : Images;
  const blocked = request.mode === 'blocked';
  const loading = request.mode === 'opening';
  return createPortal(<dialog ref={dialog} className="media-permission-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={keepFocus}
    onCancel={event => { event.preventDefault(); cancel(); }} onClick={event => { if (event.target === event.currentTarget) cancel(); }}>
    <div className="media-permission-content">
      <Icon size={28} aria-hidden="true" />
      <h2 id={titleId}>{blocked ? request.camera ? 'Camera is turned off' : 'Photos and videos are turned off' : loading ? 'Opening camera…' : request.camera ? 'Allow camera access?' : 'Allow photos and videos?'}</h2>
      <p id={descriptionId}>{blocked ? 'Your saved choice blocks this action. You can change it here or in Settings → Privacy → Photos and camera.' : loading ? 'Waiting for your device’s camera permission.' : request.camera
        ? 'Use your camera to take a photo or video for UFIConnect. Your device may also ask for camera permission.'
        : 'Choose the photos or videos you want to use in UFIConnect. Access is limited to the files you select.'}</p>
      {error && <p className="media-permission-error" role="alert">{error}</p>}
      <div className="media-permission-actions">
        {blocked ? <><button type="button" className="btn btn-outline" onClick={cancel}>Close</button><button type="button" className="btn btn-primary" onClick={() => { setError(''); setRequest({ ...request, mode: 'ask' }); }}>Change choice</button></>
          : loading || busy ? <button type="button" className="btn btn-outline" onClick={cancel}>Cancel</button>
          : <><button type="button" className="btn btn-outline" onClick={decline}>Don’t allow</button><button type="button" className="btn btn-primary" onClick={() => openPicker(request)}>{request.camera ? 'Allow camera' : 'Choose photos'}</button></>}
      </div>
    </div>
  </dialog>, document.fullscreenElement || document.body);
}
