import { useEffect, useRef } from 'react';

const HOME_SCREEN_IDLE_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel', 'keydown', 'click'];

export function createBrowserScreenAwake(wakeLock) {
  let wanted = false;
  let pending = false;
  let sentinel = null;

  return async function setAwake(awake) {
    wanted = awake;
    if (!awake) {
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) await current.release();
      return;
    }
    if (pending || (sentinel && !sentinel.released)) return;

    pending = true;
    try {
      const lock = await wakeLock.request('screen');
      if (wanted) sentinel = lock;
      else if (!lock.released) void lock.release().catch(() => {});
    } finally {
      pending = false;
    }
  };
}

export function watchScreenAwake({ setAwake, win = window, doc = document }) {
  let home = null;
  let wanted = false;
  let pageHidden = false;
  let timer = null;
  let deadline = 0;
  const capture = { capture: true, passive: true };
  const isVisible = () => home !== null && !pageHidden && !doc.hidden;

  function updateAwake(awake, retry = false) {
    if (awake === wanted && !retry) return;
    wanted = awake;
    // A browser can deny a wake lock or release it when the page becomes
    // hidden. Retry when the page returns or the user interacts again.
    void Promise.resolve().then(() => setAwake(awake)).catch(() => {});
  }

  function cancelTimer() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  function checkHomeIdle() {
    timer = null;
    if (!home || !isVisible()) return;
    const remaining = Math.ceil(deadline - win.performance.now());
    if (remaining > 0) timer = win.setTimeout(checkHomeIdle, remaining);
    else updateAwake(false);
  }

  function recordActivity(retry = false) {
    if (!isVisible()) return;
    if (home) {
      deadline = win.performance.now() + HOME_SCREEN_IDLE_MS;
      if (timer === null) timer = win.setTimeout(checkHomeIdle, HOME_SCREEN_IDLE_MS);
    }
    updateAwake(true, retry);
  }

  function syncVisibility() {
    cancelTimer();
    if (isVisible()) recordActivity(true);
    else updateAwake(false);
  }

  const onInput = event => recordActivity(event.type === 'pointerdown' || event.type === 'keydown');
  const onScroll = () => { if (timer !== null) recordActivity(); };
  const onPageHide = () => { pageHidden = true; syncVisibility(); };
  const onPageShow = () => { pageHidden = false; syncVisibility(); };
  ACTIVITY_EVENTS.forEach(event => win.addEventListener(event, onInput, capture));
  win.addEventListener('scroll', onScroll, capture);
  win.addEventListener('focus', syncVisibility);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  doc.addEventListener('visibilitychange', syncVisibility);

  return {
    setHome(next) {
      if (home === next) return;
      home = next;
      syncVisibility();
    },
    stop() {
      home = null;
      syncVisibility();
      ACTIVITY_EVENTS.forEach(event => win.removeEventListener(event, onInput, capture));
      win.removeEventListener('scroll', onScroll, capture);
      win.removeEventListener('focus', syncVisibility);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      doc.removeEventListener('visibilitychange', syncVisibility);
    },
  };
}

export function useScreenAwake({ enabled, home }) {
  const policy = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const wakeLock = window.navigator.wakeLock;
    if (!wakeLock?.request) return;
    const watcher = watchScreenAwake({ setAwake: createBrowserScreenAwake(wakeLock) });
    policy.current = watcher;
    return () => { policy.current = null; watcher.stop(); };
  }, [enabled]);

  useEffect(() => { policy.current?.setHome(home); }, [enabled, home]);
}
