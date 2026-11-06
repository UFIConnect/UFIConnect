import { useCallback, useEffect, useId, useRef, useState } from 'react';
import PipCharacter from './PipCharacter';
import './PipDock.css';

const STATUS = { idle: 'A little help, right here.', listening: 'Listening to you', thinking: 'Working on your request', working: 'Working on your request', speaking: 'Speaking with you', muted: 'Microphone paused', happy: 'Happy to help' };

function DockIcon({ name }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'expand' ? <><path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8" /></> : name === 'chevron' ? <path d="m7 10 5 5 5-5" /> : <path d="m6 6 12 12M18 6 6 18" />}
  </svg>;
}

export default function PipDock({ children, open, defaultOpen = false, onOpenChange, workspace = false, callOnly = false,
  welcomeBriefing, autoOpenWelcome = false, activity, onActivityChange, status, headerActions, onOpenWorkspace, className = '' }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen), [observedActivity, setObservedActivity] = useState('idle');
  const [retainedWelcome, setRetainedWelcome] = useState(null);
  const controlled = typeof open === 'boolean', isOpen = controlled ? open : internalOpen;
  const id = useId().replace(/:/g, ''), panelId = `pip-dock-panel-${id}`, titleId = `pip-dock-title-${id}`;
  const launcher = useRef(null), panel = useRef(null), welcomeSeen = useRef(null), focusOnOpen = useRef(false), restoreFocus = useRef(false);
  const currentSpeech = activity ?? observedActivity;
  const currentActivity = typeof currentSpeech === 'string' ? currentSpeech : currentSpeech?.phase || 'idle';
  const liveSignal = currentSpeech && typeof currentSpeech === 'object' && (typeof currentSpeech.micMuted === 'boolean' || typeof currentSpeech.speechTiming === 'string');
  const livePhase = currentActivity === 'thinking' && typeof currentSpeech?.text === 'string' && currentSpeech.text.trim() ? 'working' : currentActivity;
  const liveLabel = liveSignal ? ({ listening: 'Live · listening', speaking: 'Live · speaking', working: 'Live · working', muted: 'Live · mic paused' }[livePhase]
    || (currentSpeech.micMuted ? 'Live · mic paused' : null)) : null;
  const changeOpen = useCallback(next => { if (!controlled) setInternalOpen(next); onOpenChange?.(next); }, [controlled, onOpenChange]);

  // Drag-and-drop-to-scan: the launcher is the drag source. The drop
  // targets are the Office section buttons in the navigation, so PipDock
  // only signals drag start/end; App.jsx and OfficeNavigation own the drop.
  const [isDragging, setIsDragging] = useState(false);
  function handleDragStart(event) {
    setIsDragging(true);
    event.dataTransfer.setData('text/pip-scan', 'pip');
    event.dataTransfer.effectAllowed = 'move';
    window.dispatchEvent(new CustomEvent('pip-scan-drag-start'));
  }
  function handleDragEnd() {
    setIsDragging(false);
    window.dispatchEvent(new CustomEvent('pip-scan-drag-end'));
  }
  const reportActivity = useCallback(value => {
    setObservedActivity(typeof value === 'string' || value && typeof value === 'object' ? value : 'idle'); onActivityChange?.(value);
  }, [onActivityChange]);
  useEffect(() => {
    if (typeof welcomeBriefing?.text === 'string' && welcomeBriefing.text.trim()) setRetainedWelcome({ id: welcomeBriefing.id, text: welcomeBriefing.text });
  }, [welcomeBriefing]);
  useEffect(() => {
    const reset = () => { setRetainedWelcome(null); welcomeSeen.current = null; focusOnOpen.current = false; setObservedActivity('idle'); };
    window.addEventListener('office-token-changed', reset);
    return () => { welcomeSeen.current = null; window.removeEventListener('office-token-changed', reset); };
  }, []);
  useEffect(() => {
    if (!isOpen || !focusOnOpen.current || workspace) return;
    focusOnOpen.current = false; panel.current?.focus({ preventScroll: true });
  }, [isOpen, workspace]);
  useEffect(() => {
    if (!isOpen && restoreFocus.current) { restoreFocus.current = false; launcher.current?.focus({ preventScroll: true }); }
  }, [isOpen]);
  useEffect(() => {
    const key = welcomeBriefing?.id || welcomeBriefing?.text;
    if (!autoOpenWelcome || !key || welcomeSeen.current === key) return;
    welcomeSeen.current = key; changeOpen(true);
  }, [welcomeBriefing, autoOpenWelcome, changeOpen]);
  function hide() { focusOnOpen.current = false; restoreFocus.current = true; changeOpen(false); }
  function toggle() {
    if (isOpen && !callOnly) hide(); else { focusOnOpen.current = true; changeOpen(true); }
  }
  return <div className={`pip-dock ${workspace ? 'pip-dock-workspace' : 'pip-dock-floating'} ${className}`} data-open={isOpen} data-call-only={callOnly}>
    <section ref={panel} id={panelId} className="pip-dock-panel" hidden={!isOpen} role={workspace || callOnly ? 'region' : 'dialog'}
      aria-modal={workspace || callOnly ? undefined : false} aria-label={callOnly ? 'Pip call' : undefined} aria-labelledby={callOnly ? undefined : titleId} tabIndex={-1}
      onKeyDown={event => { if (!workspace && event.key === 'Escape') { event.stopPropagation(); hide(); } }}>
      <header className="pip-dock-header">
        <div className="pip-dock-identity"><PipCharacter state={currentActivity} speech={currentSpeech} size={48} decorative /><div><h2 id={titleId}>Pip</h2><p>{status || STATUS[currentActivity] || STATUS.idle}</p></div></div>
        <div className="pip-dock-header-actions">{headerActions}{onOpenWorkspace && !workspace && <button type="button" className="pip-dock-icon-button" onClick={onOpenWorkspace} aria-label="Open Pip workspace" title="Open workspace"><DockIcon name="expand" /></button>}<button type="button" className="pip-dock-icon-button" onClick={hide} aria-label="Minimize Pip" title="Minimize Pip"><DockIcon name="close" /></button></div>
      </header>
      <div className="pip-dock-content">
        {retainedWelcome?.text && <details key={retainedWelcome.id || retainedWelcome.text} className="pip-dock-welcome"><summary><span className="pip-dock-welcome-dot" aria-hidden="true" />Office update</summary><p>{retainedWelcome.text}</p></details>}
        {typeof children === 'function' ? children({ compact: !workspace, active: isOpen, onActivityChange: reportActivity }) : children}
      </div>
    </section>
    <button ref={launcher} hidden={isOpen} type="button" className="pip-dock-launcher" aria-label={isOpen && !callOnly ? 'Hide Pip' : 'Open Pip'}
      aria-expanded={isOpen && !callOnly} aria-controls={panelId} onClick={toggle} title={isOpen && !callOnly ? 'Hide Pip' : 'Open Pip'}
      draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd} data-dragging={isDragging || undefined}>
      <span className="pip-dock-launcher-avatar" data-dragging={isDragging || undefined}><PipCharacter state={currentActivity} speech={currentSpeech} size={48} decorative /></span><span className="pip-dock-launcher-label"><strong>Pip</strong><small>{liveLabel || (isOpen ? 'Right here with you' : 'Here when you need me')}</small></span><span className="pip-dock-launcher-chevron" data-open={isOpen}><DockIcon name="chevron" /></span>
    </button>
  </div>;
}
