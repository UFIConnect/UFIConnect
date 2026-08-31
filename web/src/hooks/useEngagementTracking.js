import { useEffect } from 'react';
import { reportConsumed, reportEngaged } from '../api/engagement';

// Genuine-read engagement signal for anything rendered in a scrolling list
// (see api/engagement.js for the view-vs-seen distinction) — a post counts
// as actually read, not just scrolled past, once it's been at least ~60%
// visible for a continuous 2 seconds. A per-card IntersectionObserver
// instance would work but means one observer per rendered card (50+ on a
// single Feed page); every card instead registers with one shared,
// module-level observer here — same "one observer, many observed elements,
// tell entries apart by identity" shape VideoFeedView.jsx's own
// active-slide observer already uses, just reused across every consumer of
// this hook instead of being local to one component.
const DWELL_MS = 2000;
const VISIBILITY_THRESHOLD = 0.6;

let sharedObserver = null;
const dwellTimers = new WeakMap(); // Element -> timeout id
const elementPostIds = new WeakMap(); // Element -> postId
const elementContexts = new WeakMap(); // Element -> feed context
const enteredViewport = new WeakSet();
const consumedElements = new WeakSet();

function handleIntersect(entries) {
  for (const entry of entries) {
    const el = entry.target;
    const postId = elementPostIds.get(el);
    if (!postId) continue;
    const context = elementContexts.get(el) || 'feed';
    const prominentlyVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;
    if (entry.isIntersecting) enteredViewport.add(el);
    if (prominentlyVisible) {
      if (dwellTimers.has(el)) continue; // already counting down
      const timer = setTimeout(() => {
        dwellTimers.delete(el);
        reportEngaged(postId, context);
      }, DWELL_MS);
      dwellTimers.set(el, timer);
    } else {
      const timer = dwellTimers.get(el);
      const passedAboveViewport = !entry.isIntersecting
        && enteredViewport.has(el)
        && !consumedElements.has(el)
        && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      if (passedAboveViewport) {
        consumedElements.add(el);
        reportConsumed(postId, context);
      }
      if (timer) { clearTimeout(timer); dwellTimers.delete(el); } // dwell interrupted — doesn't count
    }
  }
}

function getSharedObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(handleIntersect, { threshold: [0, VISIBILITY_THRESHOLD] });
  }
  return sharedObserver;
}

// elementRef: a ref to the card's root DOM node. postId: what to report
// once the dwell threshold is crossed — pass null/undefined to skip
// tracking (e.g. a post with no real id yet).
export function useEngagementTracking(elementRef, postId, context = 'feed') {
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !postId) return;
    const observer = getSharedObserver();
    elementPostIds.set(el, postId);
    elementContexts.set(el, context);
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      elementPostIds.delete(el);
      elementContexts.delete(el);
      const timer = dwellTimers.get(el);
      if (timer) { clearTimeout(timer); dwellTimers.delete(el); }
    };
  }, [elementRef, postId, context]);
}
