import { Component } from 'react';

// Leave Office navigation available if a section cannot render or load its code.
export default class OfficeViewBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() { /* React reports the error to the browser console. */ }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" style={{ padding: 24, border: '1px solid #334155', borderRadius: 12, background: '#0d1422' }}>
      <h1 style={{ fontSize: 22, marginBottom: 10 }}>This section couldn’t open</h1>
      <p style={{ color: '#94a3b8', marginBottom: 18, lineHeight: 1.6 }}>Try again or choose another Office section above.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}
        style={{ padding: '10px 16px', background: '#1d4ed8', border: 0, borderRadius: 8, color: '#fff', cursor: 'pointer', font: 'inherit' }}>
        Try this section again
      </button>
    </section>;
  }
}
