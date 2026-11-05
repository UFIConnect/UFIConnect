// Keep URL navigation and the local editor's unsaved-change guard in sync.
export function createOfficeNavigator({ target, sections, fallback, initialView, onChange, canLeave, resolveView = id => id }) {
  const saved = target.history.state?.officeNavigation;
  const reusable = typeof saved?.session === 'string' && saved.view === initialView && Number.isSafeInteger(saved.index) && saved.index >= 0;
  const session = reusable ? saved.session : `office-${Date.now()}-${Math.random()}`;
  const ids = new Set(sections.map(section => section.id));
  let current = { view: initialView, index: reusable ? saved.index : 0, url: target.location.href };
  let restoring = false;
  const stateFor = entry => ({ ...target.history.state,
    officeNavigation: { session, index: entry.index, view: entry.view } });
  target.history.replaceState(stateFor(current), '', current.url);

  function navigate(id) {
    if (!ids.has(id)) return false;
    if (id === current.view) return true;
    if (!canLeave()) return false;
    const url = new URL(target.location.href);
    url.hash = id;
    current = { view: id, index: current.index + 1, url: url.href };
    target.history.pushState(stateFor(current), '', current.url);
    onChange(id);
    return true;
  }

  function syncLocation() {
    if (restoring) { restoring = false; return; }
    const requested = target.location.hash.slice(1);
    const entry = target.history.state?.officeNavigation;
    const id = resolveView(ids.has(requested) ? requested : fallback, entry, current.view);
    if (id === current.view && target.location.href === current.url) return;
    if (id !== current.view && !canLeave()) {
      if (entry?.session === session && entry.index !== current.index) {
        restoring = true;
        target.history.go(current.index - entry.index);
      } else {
        target.history.replaceState(stateFor(current), '', current.url);
      }
      return;
    }
    current = { view: id, index: entry?.session === session ? entry.index : current.index + 1, url: target.location.href };
    target.history.replaceState(stateFor(current), '', current.url);
    onChange(id);
  }
  target.addEventListener('popstate', syncLocation);
  target.addEventListener('hashchange', syncLocation);
  return { navigate, dispose() {
    target.removeEventListener('popstate', syncLocation);
    target.removeEventListener('hashchange', syncLocation);
  } };
}
