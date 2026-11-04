import { useCallback, useEffect, useId, useRef, useState } from 'react';
import PipCharacter from './PipCharacter';
import './PipDock.css';

const STATUS = { idle: 'A little help, right here.', listening: 'Listening to you', thinking: 'Working on your request', working: 'Working on your request', speaking: 'Speaking with you', happy: 'Happy to help' };

function DockIcon({ name }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'expand' ? <><path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8" /></> : name === 'chevron' ? <path d="m7 10 5 5 5-5" /> : <path d="m6 6 12 12M18 6 6 18" />}
  </svg>;
}

export default function PipDock({ children, open, defaultOpen = false, onOpenChange, workspace = false,
  welcomeBriefing, autoOpenWelcome = false, activity, onActivityChange, status, headerActions, onOpenWorkspace, className = '' }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen), [observedActivity, setObservedActivity] = useState('idle');
  const [retainedWelcome, setRetainedWelcome] = useState(null);
  const controlled = typeof open === 'boolean', isOpen = controlled ? open : internalOpen;
  const id = useId().replace(/:/g, ''), panelId = `pip-dock-panel-${id}`, titleId = `pip-dock-title-${id}`;
  const launcher = useRef(null), panel = useRef(null), welcomeSeen = useRef(null), focusOnOpen = useRef(false);
  const currentActivity = typeof activity === 'string' ? activity : activity?.phase || observedActivity;
  const changeOpen = useCallback(next => { if (!controlled) setInternalOpen(next); onOpenChange?.(next); }, [controlled, onOpenChange]);
  const reportActivity = useCallback(value => {
    setObservedActivity(typeof value === 'string' ? value : value?.phase || 'idle'); onActivityChange?.(value);
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
    const key = welcomeBriefing?.id || welcomeBriefing?.text;
    if (!autoOpenWelcome || !key || welcomeSeen.current === key) return;
    welcomeSeen.current = key; changeOpen(true);
  }, [welcomeBriefing, autoOpenWelcome, changeOpen]);
  function hide() { focusOnOpen.current = false; changeOpen(false); launcher.current?.focus({ preventScroll: true }); }
  function toggle() {
    if (isOpen) hide(); else { focusOnOpen.current = true; changeOpen(true); }
  }
  return <div className={`pip-dock ${workspace ? 'pip-dock-workspace' : 'pip-dock-floating'} ${className}`} data-open={isOpen}>
    <section ref={panel} id={panelId} className="pip-dock-panel" hidden={!isOpen} role={workspace ? 'region' : 'dialog'}
      aria-modal={workspace ? undefined : false} aria-labelledby={titleId} tabIndex={-1}
      onKeyDown={event => { if (!workspace && event.key === 'Escape') { event.stopPropagation(); hide(); } }}>
      <header className="pip-dock-header">
        <div className="pip-dock-identity"><PipCharacter state={currentActivity} size={66} decorative /><div><span className="pip-dock-eyebrow">YOUR OFFICE COMPANION</span><h2 id={titleId}>{workspace ? 'Pip workspace' : 'Pip'}</h2><p>{status || STATUS[currentActivity] || STATUS.idle}</p></div></div>
        <div className="pip-dock-header-actions">{headerActions}{onOpenWorkspace && !workspace && <button type="button" className="pip-dock-icon-button" onClick={onOpenWorkspace} aria-label="Open Pip workspace" title="Open workspace"><DockIcon name="expand" /></button>}<button type="button" className="pip-dock-icon-button" onClick={hide} aria-label="Minimize Pip" title="Minimize Pip"><DockIcon name="close" /></button></div>
      </header>
      {retainedWelcome?.text && <div className="pip-dock-welcome" role="status"><span className="pip-dock-welcome-dot" aria-hidden="true" /><p>{retainedWelcome.text}</p></div>}
      <div className="pip-dock-content">{typeof children === 'function' ? children({ compact: !workspace, active: isOpen, onActivityChange: reportActivity }) : children}</div>
      <div className="pip-dock-footer"><span aria-hidden="true">✦</span> A space to think, make, and get things done.</div>
    </section>
    <button ref={launcher} type="button" className="pip-dock-launcher" aria-label={isOpen ? 'Hide Pip' : 'Open Pip'}
      aria-expanded={isOpen} aria-controls={panelId} onClick={toggle} title={isOpen ? 'Hide Pip' : 'Open Pip'}>
      <span className="pip-dock-launcher-avatar"><PipCharacter state={currentActivity} size={48} decorative /></span><span className="pip-dock-launcher-label"><strong>Pip</strong><small>{isOpen ? 'Right here with you' : 'Here when you need me'}</small></span><span className="pip-dock-launcher-chevron" data-open={isOpen}><DockIcon name="chevron" /></span>
    </button>
  </div>;
}
