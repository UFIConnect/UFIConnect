import { useEffect, useRef } from 'react';

export default function useInfiniteScroll({ enabled, onLoadMore, revision }) {
  const anchorRef = useRef(null), latest = useRef(onLoadMore);
  latest.current = onLoadMore;
  useEffect(() => {
    if (!enabled || !anchorRef.current) return;
    const anchor = anchorRef.current;
    let root = anchor.parentElement;
    while (root && root !== document.body && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const target = root && root !== document.body ? root : window;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = anchor.getBoundingClientRect();
        const viewport = target === window ? { top: 0, bottom: window.innerHeight } : target.getBoundingClientRect();
        if (rect.top <= viewport.bottom + 500 && rect.bottom >= viewport.top - 500) void latest.current();
      });
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) void latest.current(); },
      { root: target === window ? null : target, rootMargin: '500px 0px' },
    ) : null;
    observer?.observe(anchor); check();
    target.addEventListener('scroll', check, { passive: true });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); target.removeEventListener('scroll', check); };
  }, [enabled, revision]);
  return anchorRef;
}
