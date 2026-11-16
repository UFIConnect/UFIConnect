import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { safePostLink } from '../../../backend/post-links.mjs';
import { isNativeRuntime, nativeExternalOpen, reportNativeError } from '../nativeRuntime.mjs';
import './PostCardChrome.css';

const PAGE_SIZE = 4;
const ENABLED_OPTIONS = '[role="menuitem"]:not(:disabled)';

function positionMenu(menu, button) {
  const viewport = window.visualViewport;
  const style = getComputedStyle(menu);
  const edge = side => Math.max(12, Number.parseFloat(style.getPropertyValue(`--post-menu-inset-${side}`)) || 0);
  const gap = 6;
  const offsetLeft = viewport?.offsetLeft ?? 0;
  const offsetTop = viewport?.offsetTop ?? 0;
  const left = offsetLeft + edge('left');
  const top = offsetTop + edge('top');
  const right = offsetLeft + (viewport?.width ?? document.documentElement.clientWidth) - edge('right');
  const bottom = offsetTop + (viewport?.height ?? window.innerHeight) - edge('bottom');
  menu.style.maxWidth = `${Math.max(0, right - left)}px`;
  menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const { height, width } = menu.getBoundingClientRect();
  const anchor = button.getBoundingClientRect();
  const below = bottom - anchor.bottom - gap;
  const above = anchor.top - gap - top;
  const y = below >= height || below > above ? Math.min(anchor.bottom + gap, bottom - height) : anchor.top - gap - height;
  menu.style.top = `${Math.max(top, y)}px`;
  menu.style.left = `${Math.max(left, Math.min(anchor.right - width, right - width))}px`;
}

function focusOption(target, list) {
  target.focus({ preventScroll: true });
  if (!list.contains(target)) return;
  const bounds = list.getBoundingClientRect();
  const option = target.getBoundingClientRect();
  if (option.top < bounds.top) list.scrollTop += option.top - bounds.top;
  else if (option.bottom > bounds.bottom) list.scrollTop += option.bottom - bounds.bottom;
}

function OptionsPanel({ id, label, items, initialFocus, trigger, close, prompt, error, pending }) {
  const panel = useRef(null);
  const list = useRef(null);
  const returnTo = useRef(null);
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const activePage = Math.min(page, pageCount - 1);
  const start = activePage * PAGE_SIZE;

  useLayoutEffect(() => {
    const menu = panel.current;
    positionMenu(menu, trigger.current);
    list.current.scrollTop = 0;
    const targets = [...menu.querySelectorAll(ENABLED_OPTIONS)];
    const previous = !prompt && targets.find(target => target.dataset.optionKey === returnTo.current);
    const first = initialFocus.current === 'last' ? targets.at(-1) : targets[0];
    focusOption(previous || first || menu, list.current);
    if (!prompt) returnTo.current = null;
  }, [activePage, pageCount, prompt, pending, initialFocus, trigger]);

  useEffect(() => {
    const menu = panel.current;
    const button = trigger.current;
    const viewport = window.visualViewport;
    const reposition = () => positionMenu(menu, button);
    const outside = event => {
      if (!button.contains(event.target) && !menu.contains(event.target)) close(false);
    };
    const fullscreenChanged = () => close(false);
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
    resize?.observe(menu);
    resize?.observe(button);
    const anchor = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) close(false); }) : null;
    anchor?.observe(button);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    viewport?.addEventListener('scroll', reposition);
    viewport?.addEventListener('resize', reposition);
    return () => {
      resize?.disconnect();
      anchor?.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      viewport?.removeEventListener('scroll', reposition);
      viewport?.removeEventListener('resize', reposition);
    };
  }, [close, trigger]);

  function movePage(step) {
    const next = activePage + step;
    if (next < 0 || next >= pageCount) return;
    initialFocus.current = 'first';
    setPage(next);
  }

  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === 'Tab') {
      if (pending) event.preventDefault();
      else close();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      movePage(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const keys = ['Home', 'End', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const targets = [...panel.current.querySelectorAll(ENABLED_OPTIONS)];
    if (!targets.length) return;
    const index = targets.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = targets[0];
    else if (event.key === 'End') next = targets.at(-1);
    else if (event.key === 'ArrowUp') next = targets[index <= 0 ? targets.length - 1 : index - 1];
    else next = targets[(index + 1) % targets.length];
    focusOption(next, list.current);
  }

  return (
    <div ref={panel} id={id} className="post-chrome-menu" role="menu" aria-label={label} tabIndex={-1}
      aria-busy={pending || undefined} aria-describedby={prompt ? `${id}-prompt` : undefined}
      onKeyDown={onKeyDown} onClick={event => event.stopPropagation()}>
      <div ref={list} className="post-chrome-menu-items" role="presentation">
        {prompt && <p id={`${id}-prompt`} className="post-chrome-menu-prompt">{prompt}</p>}
        {items.slice(start, start + PAGE_SIZE).map(item => {
          const key = item.key ?? item.label;
          const unavailable = pending || item.busy || item.disabled;
          const props = {
            role: 'menuitem', tabIndex: -1, 'data-option-key': key, 'aria-label': item.ariaLabel,
            className: item.danger ? 'post-chrome-menu-danger' : undefined,
            onClick: event => {
              if (item.keepOpen) {
                initialFocus.current = 'first';
                if (!prompt) returnTo.current = key;
              } else close();
              if (item.href && !event.defaultPrevented && isNativeRuntime()) {
                event.preventDefault();
                void nativeExternalOpen(item.href).catch(() => reportNativeError('The source could not be opened. Please try again.'));
              }
              item.onSelect?.();
            },
          };
          const content = <>{item.icon}<span><span className="post-chrome-menu-label">{item.busy ? `${item.label}…` : item.label}</span>{item.detail && <small>{item.detail}</small>}</span></>;
          if (!unavailable && item.to) return <Link key={key} to={item.to} {...props}>{content}</Link>;
          if (!unavailable && item.href) return <a key={key} href={item.href} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
          return <button key={key} type="button" disabled={unavailable} {...props}>{content}</button>;
        })}
        {error && <p className="post-chrome-menu-error" role="alert">{error}</p>}
      </div>
      {pageCount > 1 && <div className="post-chrome-menu-pages" role="group" aria-label="Options pages">
        <button type="button" role="menuitem" tabIndex={-1} aria-label="Previous options" disabled={activePage === 0 || pending} onClick={() => movePage(-1)}>Previous</button>
        <span aria-live="polite" aria-atomic="true">{activePage + 1} / {pageCount}</span>
        <button type="button" role="menuitem" tabIndex={-1} aria-label="Next options" disabled={activePage === pageCount - 1 || pending} onClick={() => movePage(1)}>Next</button>
      </div>}
    </div>
  );
}

export default function PostOptionsPopover({ items, label, triggerLabel = 'More options', trigger, open, onOpenChange, prompt, error, pending = false }) {
  const id = useId();
  const initialFocus = useRef('first');
  const available = items.flatMap(item => {
    if (!item) return [];
    if (!item.href) return [item];
    const href = safePostLink(item.href);
    return href ? [{ ...item, href }] : [];
  });
  const close = useCallback((restoreFocus = true) => {
    if (pending) return;
    onOpenChange(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, [onOpenChange, pending, trigger]);
  if (!available.length) return null;

  const root = open && (document.fullscreenElement?.contains(trigger.current)
    ? document.fullscreenElement : trigger.current?.closest('dialog[open]') || document.body);
  return (
    <div className="post-chrome-more">
      <button ref={trigger} type="button" className="post-chrome-action" aria-label={triggerLabel} title={triggerLabel}
        aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} disabled={pending}
        onClick={event => {
          event.stopPropagation();
          if (open) close();
          else { initialFocus.current = 'first'; onOpenChange(true); }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
            onOpenChange(true);
          }
        }}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {root && createPortal(<OptionsPanel id={id} label={label} items={available} trigger={trigger} close={close}
        initialFocus={initialFocus} prompt={prompt} error={error} pending={pending} />, root)}
    </div>
  );
}
