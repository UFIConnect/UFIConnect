import { useEffect, useRef } from 'react';

// Gives every scrolling surface the same top-edge refresh behavior:
// pull down while already at the top on touch devices, or keep scrolling
// upward at the top with a mouse wheel/trackpad on desktop. Returning to the
// top from farther down remains supported as a convenient desktop shortcut.
export function useScrollToRefresh(onRefresh, {
  enabled = true,
  containerRef = null,
  cooldownMs = 8000,
  minScrollBeforePull = 40,
  touchPullDistance = 72,
  wheelPullDistance = 100,
} = {}) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return undefined;

    const target = containerRef ? containerRef.current : window;
    if (!target) return undefined;

    const getY = () => (containerRef ? (containerRef.current?.scrollTop ?? 0) : window.scrollY);
    const touchPrimary = navigator.maxTouchPoints > 0
      && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    let lastY = getY();
    let lastRefreshAt = 0;
    let refreshInFlight = false;
    let touchStartY = null;
    let touchDistance = 0;
    let wheelDistance = 0;
    let wheelResetTimer = null;

    const triggerRefresh = () => {
      const now = Date.now();
      if (refreshInFlight || now - lastRefreshAt < cooldownMs) return;
      lastRefreshAt = now;
      refreshInFlight = true;
      try {
        Promise.resolve(onRefreshRef.current?.())
          .catch(() => {})
          .finally(() => { refreshInFlight = false; });
      } catch {
        refreshInFlight = false;
      }
    };

    const handleScroll = () => {
      const y = getY();
      const returnedToTop = y <= 1 && lastY > minScrollBeforePull;
      lastY = y;
      if (returnedToTop && !touchPrimary) triggerRefresh();
    };

    const handleTouchStart = (event) => {
      if (getY() > 1 || event.touches.length !== 1) {
        touchStartY = null;
        touchDistance = 0;
        return;
      }
      touchStartY = event.touches[0].clientY;
      touchDistance = 0;
    };

    const handleTouchMove = (event) => {
      if (touchStartY == null || getY() > 1 || event.touches.length !== 1) return;
      touchDistance = Math.max(0, event.touches[0].clientY - touchStartY);
    };

    const handleTouchEnd = () => {
      if (touchStartY != null && touchDistance >= touchPullDistance && getY() <= 1) {
        triggerRefresh();
      }
      touchStartY = null;
      touchDistance = 0;
    };

    const handleWheel = (event) => {
      if (getY() > 1 || event.deltaY >= 0) {
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
    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: true });
    target.addEventListener('touchend', handleTouchEnd, { passive: true });
    target.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    target.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      target.removeEventListener('scroll', handleScroll);
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      target.removeEventListener('touchcancel', handleTouchEnd);
      target.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, containerRef, cooldownMs, minScrollBeforePull, touchPullDistance, wheelPullDistance]);
}
