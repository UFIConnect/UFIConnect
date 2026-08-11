import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import VideoFeedView from '../components/VideoFeedView';

// A top-level route (not nested inside Feed's own view-mode tabs) so it
// shows up as its own item in the main nav, next to Feed/Search/etc. — a
// TikTok-style full-screen takeover, deliberately not wrapped in the usual
// Layout sidebar/content shell.
export default function Videos() {
  const navigate = useNavigate();
  return (
    <>
      <Helmet>
        <title>Videos | UFconnect</title>
      </Helmet>
      <VideoFeedView onExit={() => navigate('/')} />
    </>
  );
}
