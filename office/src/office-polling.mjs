export function officePollingPlan(view, visible = true) {
  if (!visible) return { tasks: [], stream: false };
  const fastStatus = ['overview', 'city', 'pipeline'].includes(view);
  const pipelineOnly = ['sources', 'feed'].includes(view);
  const slowStatus = ['agents', 'versions', 'deploy'].includes(view);
  const tasks = [];
  if (fastStatus || pipelineOnly || slowStatus) {
    tasks.push({ id: 'api', intervalMs: fastStatus ? 8000 : 60000 });
    tasks.push({ id: 'pipeline', intervalMs: fastStatus || pipelineOnly ? 8000 : 60000 });
  }
  if (['overview', 'city', 'agents'].includes(view)) tasks.push({ id: 'agents', intervalMs: 15000 });
  if (view === 'versions') tasks.push({ id: 'versions', intervalMs: 60000 });
  return { tasks, stream: ['overview', 'city', 'agents', 'deploy'].includes(view) };
}

// Schedule from completion, not from request start. A slow service gets one
// read at a time; hidden pages cancel reads and resume with one fresh read.
export function createVisibleOfficePoller({ task, intervalMs, document: page = globalThis.document,
  schedule = setTimeout, cancel = clearTimeout, onError = () => {} }) {
  let stopped = false, timer = null, pending = null, controller = null, refreshAfter = false;
  const visible = () => !page || (page.visibilityState !== 'hidden' && page.hidden !== true);
  const clear = () => { if (timer !== null) { cancel(timer); timer = null; } };
  function run() {
    clear();
    if (stopped || !visible()) return;
    if (pending) { refreshAfter = true; return; }
    controller = new AbortController();
    const current = controller;
    pending = Promise.resolve().then(() => task({ signal: current.signal })).catch(error => {
      if (!stopped && !current.signal.aborted) onError(error);
    }).finally(() => {
      pending = null;
      if (controller === current) controller = null;
      if (stopped || !visible()) return;
      if (refreshAfter) { refreshAfter = false; run(); }
      else timer = schedule(run, typeof intervalMs === 'function' ? intervalMs() : intervalMs);
    });
  }
  const visibility = () => {
    clear();
    if (visible()) run();
    else { refreshAfter = false; controller?.abort(); }
  };
  page?.addEventListener('visibilitychange', visibility);
  run();
  return { refresh: run, stop() { stopped = true; clear(); controller?.abort(); page?.removeEventListener('visibilitychange', visibility); } };
}
