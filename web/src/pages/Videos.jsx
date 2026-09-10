import { useNavigate } from 'react-router-dom';
import { Component } from 'react';
import { Helmet } from 'react-helmet-async';
import VideoFeedView from '../components/VideoFeedView';
import { reportClientError } from '../api/errorReporting';

class VideoFeedErrorBoundary extends Component {
  state = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportClientError({
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  retry = () => {
    this.setState(state => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, background: '#000', color: '#fff', textAlign: 'center' }}>
          <strong style={{ fontSize: '1.15rem' }}>That video needs another try.</strong>
          <span style={{ maxWidth: 310, color: 'rgba(255,255,255,.72)', fontSize: '.9rem' }}>Your place is safe. Reload the video feed or return home.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={this.props.onExit}>Back to Home</button>
            <button type="button" className="btn btn-primary" onClick={this.retry}>Try again</button>
          </div>
        </div>
      );
    }
    return <VideoFeedView key={`${this.props.music}-${this.state.retryKey}`} music={this.props.music} onExit={this.props.onExit} />;
  }
}

// A top-level route (not nested inside Feed's own view-mode tabs) so it
// shows up as its own item in the main nav, next to Feed/Search/etc. — a
// TikTok-style full-screen takeover, deliberately not wrapped in the usual
// Layout sidebar/content shell.
export default function Videos({ music = false }) {
  const navigate = useNavigate();
  return (
    <>
      <Helmet>
        <title>{music ? 'Music' : 'Videos'} | UFIconnect</title>
      </Helmet>
      <VideoFeedErrorBoundary music={music} onExit={() => navigate('/?feed=feed&all=1')} />
    </>
  );
}
