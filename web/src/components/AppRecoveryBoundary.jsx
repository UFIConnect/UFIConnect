import { Component } from 'react';
import { reportClientError } from '../api/errorReporting';

export default class AppRecoveryBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) {
    document.getElementById('root')?.removeAttribute('data-session-shell');
    reportClientError({ code: 'render_error' });
    // An old document can request a chunk removed by a new release. Retry
    // a fresh document once; if it still fails, keep the recovery controls.
    const missingChunk = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i.test(String(error?.message || ''));
    if (!missingChunk) return;
    try {
      const key = 'uficonnect.route-recovery.v1', attemptedAt = Number(window.sessionStorage.getItem(key));
      if (attemptedAt && Date.now() - attemptedAt < 300000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    } catch { /* Keep manual recovery when browser storage is unavailable. */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const base = import.meta.env.BASE_URL || '/';
    return <main className="session-recovery" role="alert">
      <h1>We could not open this page</h1>
      <p>Reload to try again. Your saved sign-in session will be checked automatically.</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload page</button>
      <p><a href={`${base}login`}>Open sign in</a> · <a href={base}>Home</a></p>
    </main>;
  }
}
