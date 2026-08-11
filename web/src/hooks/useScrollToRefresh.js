import { useEffect, useRef } from 'react';

// Sitewide scroll-to-refresh: scrolling back up to the very top of a list
// (window-level for most pages, or a specific scrollable container for
// things like the Videos rail) is read the same way native pull-to-refresh
// reads a drag gesture — "the user wants fresh content" — without needing
// separate touch/mouse-drag plumbing duplicated on every page. This is the
// same pattern Feed.jsx already used for its own scroll-to-refresh; pulled
// out here so every other list-style page (Videos, Sources, Groups,
// Opportunities, Search, Notifications, group detail) can wire up the exact
// same behavior instead of each page growing its own bespoke refresh button
// as the primary way to get new content.
export function useScrollToRefresh(onRefresh, {
  enabled = true,
  containerRef = null,
  cooldownMs = 8000,
  minScrollBeforePull = 40,
} = {}) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const target = containerRef ? containerRef.current : window;
    if (!target) return;
    const getY = () => (containerRef ? (containerRef.current?.scrollTop ?? 0) : window.scrollY);
    let lastY = getY();
    let lastPullAt = 0;
    const handleScroll = () => {
      const y = getY();
      const pulledToTop = y <= 0 && lastY > minScrollBeforePull;
      lastY = y;
      if (!pulledToTop) return;
      if (Date.now() - lastPullAt < cooldownMs) return;
      lastPullAt = Date.now();
      onRefreshRef.current?.();
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, [enabled, containerRef, cooldownMs, minScrollBeforePull]);
}
