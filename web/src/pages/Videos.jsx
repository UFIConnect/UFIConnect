import Layout from '../components/Layout';
﻿import { useNavigate } from 'react-router-dom';
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
        <div style={{ minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, background: '#000', color: '#fff', textAlign: 'center' }}>
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

export default function Videos({ music = false }) {
  const navigate = useNavigate();
  return (
    <>
      <Helmet>
        <title>{music ? 'Music' : 'Videos'} | UFIconnect</title>
      </Helmet>
      <Layout><VideoFeedErrorBoundary music={music} onExit={() => navigate('/?feed=feed&all=1')} /></Layout>
    </>
  );
}
