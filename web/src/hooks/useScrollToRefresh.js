import { useEffect, useRef, useState } from 'react';

const IDLE_STATE = Object.freeze({ pulling: false, progress: 0, refreshing: false });
const REFRESHING_STATE = Object.freeze({ pulling: false, progress: 1, refreshing: true });
const IGNORE_GESTURE = [
  'input', 'textarea', 'select', 'button', 'a', 'form', 'video', 'audio',
  '[contenteditable]:not([contenteditable="false"])', '[role="button"]', '[role="slider"]',
  'dialog', '[role="dialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="listbox"]',
  '.feed-source-tabs', '.snap-rail', '[data-scroll-refresh="ignore"]',
].join(',');
const scrollsVertically = element => /^(auto|scroll|overlay)$/.test(window.getComputedStyle(element).overflowY);

// Pull down at the top of the page, or keep wheeling upward at the top on
// desktop. Nested feeds can provide their own container; returning to the
// top through ordinary scrolling or navigation never starts a request.
export function useScrollToRefresh(onRefresh, {
  enabled = true,
  containerRef = null,
  cooldownMs = 1500,
  touchPullDistance = 56,
  wheelPullDistance = 100,
  topThreshold = 12,
} = {}) {
  const onRefreshRef = useRef(onRefresh);
  const lastRefreshAtRef = useRef(-Infinity);
  const pendingRefreshRef = useRef(null);
  const [state, setState] = useState(IDLE_STATE);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_STATE);
      return undefined;
    }

    const target = containerRef ? containerRef.current : window;
    if (!target) return undefined;

    // A responsive container can switch between an independent scroller and
    // normal document flow. Read its actual scroll root at gesture time.
    const getRoot = () => {
      let element = containerRef?.current;
      while (element && element !== document.body && element !== document.documentElement) {
        if (scrollsVertically(element)) return element;
        element = element.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    const getY = root => Math.max(0, root.scrollTop || 0);
    const gestureRoot = event => {
      const origin = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!origin || origin.closest(IGNORE_GESTURE)) return null;
      const root = getRoot();
      // A rail, comments panel, or another independently scrolling feed must
      // consume its own gesture even when its scroll position is also zero.
      for (let element = origin; element && element !== root; element = element.parentElement) {
        if (element !== document.body && element !== document.documentElement && scrollsVertically(element)) return null;
      }
      return root;
    };

    let active = true;
    let touch = null;
    let wheelDistance = 0;
    let wheelRoot = null;
    let wheelResetTimer = null;
    const rootPositions = new WeakMap();
    const initialRoot = getRoot();
    rootPositions.set(initialRoot, { y: getY(initialRoot), reachedTopAt: -Infinity });
    const handleScroll = event => {
      const root = getRoot();
      if (event.target !== root && !(root === document.scrollingElement && event.target === document)) return;
      const previous = rootPositions.get(root);
      const y = getY(root);
      rootPositions.set(root, {
        y,
        reachedTopAt: previous?.y > topThreshold && y <= topThreshold ? performance.now() : previous?.reachedTopAt ?? -Infinity,
      });
    };

    const observeCompletion = promise => {
      promise.then(() => { if (active) setState(IDLE_STATE); });
    };
    // Disabling a busy hook must not lose the request lock. When its surface
    // becomes active again, keep the indicator until that same request ends.
    if (pendingRefreshRef.current) {
      setState(REFRESHING_STATE);
      observeCompletion(pendingRefreshRef.current);
    } else {
      setState(IDLE_STATE);
    }

    const triggerRefresh = () => {
      if (pendingRefreshRef.current || Date.now() - lastRefreshAtRef.current < cooldownMs) return;
      const refresh = onRefreshRef.current;
      if (typeof refresh !== 'function') return;
      lastRefreshAtRef.current = Date.now();
      setState(REFRESHING_STATE);
      const pending = Promise.resolve().then(refresh).catch(() => {}).then(() => {
        pendingRefreshRef.current = null;
        lastRefreshAtRef.current = Date.now();
      });
      pendingRefreshRef.current = pending;
      observeCompletion(pending);
    };

    const resetTouch = () => {
      touch = null;
      if (!pendingRefreshRef.current) setState(IDLE_STATE);
    };
    const handleTouchStart = event => {
      resetTouch();
      if (pendingRefreshRef.current || event.touches.length !== 1) return;
      const root = gestureRoot(event);
      if (!root || getY(root) > topThreshold) return;
      touch = { root, x: event.touches[0].clientX, y: event.touches[0].clientY, distance: 0 };
    };
    const handleTouchMove = event => {
      if (!touch) return;
      if (pendingRefreshRef.current || event.touches.length !== 1 || getY(touch.root) > topThreshold) {
        resetTouch();
        return;
      }
      const vertical = event.touches[0].clientY - touch.y;
      const horizontal = Math.abs(event.touches[0].clientX - touch.x);
      // Once a swipe is horizontal or moves upward, it belongs to native
      // navigation/scrolling for the rest of this touch sequence.
      if ((horizontal > 8 && horizontal > Math.abs(vertical)) || vertical < -8) {
        resetTouch();
        return;
      }
      touch.distance = Math.max(0, vertical);
      const progress = Math.min(1, touch.distance / touchPullDistance);
      setState(progress > 0 ? { pulling: true, progress, refreshing: false } : IDLE_STATE);
    };
    const handleTouchEnd = () => {
      const shouldRefresh = touch && touch.distance >= touchPullDistance && getY(touch.root) <= topThreshold;
      resetTouch();
      if (shouldRefresh) triggerRefresh();
    };
    const resetWheel = () => {
      wheelDistance = 0;
      wheelRoot = null;
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = null;
    };
    const handleWheel = event => {
      const root = gestureRoot(event);
      const position = root && rootPositions.get(root);
      // The compositor can scroll before a passive wheel listener runs. Keep
      // a short top-arrival guard so that final native scroll event cannot
      // masquerade as an additional pull at the top.
      if (pendingRefreshRef.current || !root || getY(root) > topThreshold || position?.y > topThreshold || performance.now() - (position?.reachedTopAt ?? -Infinity) < 120 || event.ctrlKey || event.deltaY >= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        resetWheel();
        return;
      }
      if (wheelRoot !== root) resetWheel();
      wheelRoot = root;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight || window.innerHeight : 1;
      wheelDistance += Math.abs(event.deltaY * unit);
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(resetWheel, 450);
      if (wheelDistance >= wheelPullDistance) {
        resetWheel();
        triggerRefresh();
      }
    };

    // Passive listeners leave native vertical scrolling and horizontal swipe
    // navigation intact. Capture sees gestures without fighting card handlers.
    const options = { passive: true, capture: true };
    target.addEventListener('scroll', handleScroll, options);
    target.addEventListener('touchstart', handleTouchStart, options);
    target.addEventListener('touchmove', handleTouchMove, options);
    target.addEventListener('touchend', handleTouchEnd, options);
    target.addEventListener('touchcancel', resetTouch, options);
    target.addEventListener('wheel', handleWheel, options);

    return () => {
      active = false;
      resetWheel();
      target.removeEventListener('scroll', handleScroll, true);
      target.removeEventListener('touchstart', handleTouchStart, true);
      target.removeEventListener('touchmove', handleTouchMove, true);
      target.removeEventListener('touchend', handleTouchEnd, true);
      target.removeEventListener('touchcancel', resetTouch, true);
      target.removeEventListener('wheel', handleWheel, true);
    };
  }, [enabled, containerRef, cooldownMs, touchPullDistance, wheelPullDistance, topThreshold]);

  return state;
}
