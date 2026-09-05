import { useEffect, useRef, useState } from 'react';

const IDLE_STATE = Object.freeze({ pulling: false, progress: 0, refreshing: false });

// Gives every scrolling surface the same top-edge refresh behavior:
// pull down while already at the top on touch devices, or keep scrolling
// upward at the top with a mouse wheel/trackpad on desktop. Returning to the
// top from farther down remains supported as a convenient desktop shortcut.
export function useScrollToRefresh(onRefresh, {
  enabled = true,
  containerRef = null,
  cooldownMs = 8000,
  minScrollBeforePull = 40,
  touchPullDistance = 56,
  wheelPullDistance = 100,
  topThreshold = 12,
} = {}) {
  const onRefreshRef = useRef(onRefresh);
  const [state, setState] = useState(IDLE_STATE);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_STATE);
      return undefined;
    }

    const target = containerRef ? containerRef.current : window;
    if (!target) return undefined;

    const getY = () => {
      if (containerRef) return Math.max(0, containerRef.current?.scrollTop ?? 0);
      const documentY = document.scrollingElement?.scrollTop;
      return Math.max(0, Number.isFinite(documentY) ? documentY : (window.scrollY || window.pageYOffset || 0));
    };
    let lastY = getY();
    let lastRefreshAt = 0;
    let refreshInFlight = false;
    let touchStartY = null;
    let touchStartX = null;
    let touchDistance = 0;
    let wheelDistance = 0;
    let wheelResetTimer = null;

    const triggerRefresh = () => {
      const now = Date.now();
      if (refreshInFlight || now - lastRefreshAt < cooldownMs) return;
      lastRefreshAt = now;
      refreshInFlight = true;
      setState({ pulling: false, progress: 1, refreshing: true });
      try {
        Promise.resolve(onRefreshRef.current?.())
          .catch(() => {})
          .finally(() => {
            refreshInFlight = false;
            setState(IDLE_STATE);
          });
      } catch {
        refreshInFlight = false;
        setState(IDLE_STATE);
      }
    };

    const handleScroll = () => {
      const y = getY();
      const returnedToTop = y <= topThreshold && lastY > minScrollBeforePull;
      lastY = y;
      // Reaching the top after a real scroll is itself a refresh gesture on
      // every input type. Touch users can additionally pull while already at
      // the top; desktop users can keep wheeling upward there.
      if (returnedToTop) triggerRefresh();
    };

    const handleTouchStart = (event) => {
      if (getY() > topThreshold || event.touches.length !== 1) {
        touchStartY = null;
        touchStartX = null;
        touchDistance = 0;
        return;
      }
      touchStartY = event.touches[0].clientY;
      touchStartX = event.touches[0].clientX;
      touchDistance = 0;
    };

    const handleTouchMove = (event) => {
      if (touchStartY == null || getY() > topThreshold || event.touches.length !== 1) return;
      const vertical = event.touches[0].clientY - touchStartY;
      const horizontal = Math.abs(event.touches[0].clientX - touchStartX);
      touchDistance = vertical > horizontal ? Math.max(0, vertical) : 0;
      const progress = Math.min(1, touchDistance / touchPullDistance);
      setState(progress > 0
        ? { pulling: true, progress, refreshing: false }
        : IDLE_STATE);
    };

    const handleTouchEnd = () => {
      if (touchStartY != null && touchDistance >= touchPullDistance && getY() <= topThreshold) {
        triggerRefresh();
      } else if (!refreshInFlight) {
        setState(IDLE_STATE);
      }
      touchStartY = null;
      touchStartX = null;
      touchDistance = 0;
    };

    const handleWheel = (event) => {
      if (getY() > topThreshold || event.deltaY >= 0) {
        wheelDistance = 0;
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      wheelDistance += Math.abs(event.deltaY * unit);
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(() => { wheelDistance = 0; }, 450);
      if (wheelDistance >= wheelPullDistance) {
        wheelDistance = 0;
        triggerRefresh();
      }
    };

    target.addEventListener('scroll', handleScroll, { passive: true });
    // Capture touch gestures before nested rails or cards can stop bubbling.
    // The listeners stay passive, so native scrolling remains in full control.
    const touchOptions = { passive: true, capture: true };
    target.addEventListener('touchstart', handleTouchStart, touchOptions);
    target.addEventListener('touchmove', handleTouchMove, touchOptions);
    target.addEventListener('touchend', handleTouchEnd, touchOptions);
    target.addEventListener('touchcancel', handleTouchEnd, touchOptions);
    target.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      target.removeEventListener('scroll', handleScroll);
      target.removeEventListener('touchstart', handleTouchStart, true);
      target.removeEventListener('touchmove', handleTouchMove, true);
      target.removeEventListener('touchend', handleTouchEnd, true);
      target.removeEventListener('touchcancel', handleTouchEnd, true);
      target.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, containerRef, cooldownMs, minScrollBeforePull, touchPullDistance, wheelPullDistance, topThreshold]);

  return state;
}
