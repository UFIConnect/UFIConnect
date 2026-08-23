import { useEffect } from 'react';

// Plain `overflow: hidden` on <body> does NOT stop touch-driven scrolling
// on iOS Safari — confirmed live (WebKit + iPhone viewport): a full-screen
// overlay (the media lightbox, the Videos swipe feed) using just that let
// the page underneath keep scrolling behind it, dragging the overlay's own
// "fixed" controls — including its close/exit button — out of the visible
// viewport along with it. Pinning the body itself in place (position:
// fixed, offset by the negative scroll position) is the standard
// workaround that actually holds on iOS, restoring the exact scroll
// position on unmount. Every overlay that needs to block background
// scroll should use this instead of touching document.body.style directly.
export function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
