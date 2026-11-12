import { useEffect } from 'react';
import { reportConsumed, reportEngaged, reportEngagementSignal } from '../api/engagement';
import { getAccessToken } from '../auth/session';

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
const cards = new WeakMap();
const visibleCards = new Set();
const enteredViewport = new WeakSet();
const consumedElements = new WeakSet();

function startDwell(el) {
  const token = getAccessToken();
  const card = cards.get(el);
  if (!token || !card || document.hidden || dwellTimers.has(el)) return;
  dwellTimers.set(el, setTimeout(() => {
    dwellTimers.delete(el);
    if (document.hidden || getAccessToken() !== token) return;
    reportEngaged(card.postId, card.context);
    reportEngagementSignal({ ...card, readMs: DWELL_MS });
  }, DWELL_MS));
}

function stopDwell(el) {
  clearTimeout(dwellTimers.get(el));
  dwellTimers.delete(el);
}

function handleIntersect(entries) {
  for (const entry of entries) {
    const el = entry.target;
    const card = cards.get(el);
    if (!card) continue;
    const prominentlyVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;
    if (entry.isIntersecting) enteredViewport.add(el);
    if (prominentlyVisible) {
      visibleCards.add(el);
      startDwell(el);
    } else {
      visibleCards.delete(el);
      stopDwell(el);
      const passedAboveViewport = !entry.isIntersecting
        && enteredViewport.has(el)
        && !consumedElements.has(el)
        && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      if (passedAboveViewport) {
        consumedElements.add(el);
        reportConsumed(card.postId, card.context);
      }
    }
  }
}

function getSharedObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(handleIntersect, { threshold: [0, VISIBILITY_THRESHOLD] });
    document.addEventListener('visibilitychange', () => {
      for (const el of visibleCards) {
        stopDwell(el);
        if (!document.hidden) {
          sharedObserver.unobserve(el);
          sharedObserver.observe(el);
        }
      }
    });
  }
  return sharedObserver;
}

export function useEngagementTracking(elementRef, post, context = 'feed') {
  const { id: postId, source, topic } = post || {};
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !postId || typeof IntersectionObserver === 'undefined') return;
    const observer = getSharedObserver();
    cards.set(el, { postId, source, topic, context });
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      cards.delete(el);
      visibleCards.delete(el);
      enteredViewport.delete(el);
      consumedElements.delete(el);
      stopDwell(el);
    };
  }, [elementRef, postId, source, topic, context]);
}
