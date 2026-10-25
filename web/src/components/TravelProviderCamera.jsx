import { ArrowUpRight, Video } from 'lucide-react';
import { providerCameraPlayback, providerCameraStatus } from './travelCameraPlayback.mjs';
import './TravelProviderCamera.css';

export default function TravelProviderCamera({ camera, compact = false }) {
  const playback = providerCameraPlayback(camera);
  if (!playback) return null;
  const verified = camera.liveVerified && camera.providerStatus === 'live';
  return <article className={`travel-provider-camera${compact ? ' travel-provider-camera--compact' : ''}`} aria-label={`${camera.city} camera from ${playback.providerName}`}>
    {!compact && <span className="travel-provider-camera-icon" aria-hidden="true"><Video size={28} /></span>}
    <div className="travel-provider-camera-copy">
      <p className="travel-provider-camera-provider">{playback.providerName}</p>
      <h3>{camera.liveStreamTitle || camera.title}</h3>
      <p className={verified ? 'travel-provider-camera-status' : ''} role="status">{providerCameraStatus(camera)}</p>
      {camera.liveMediaKind === 'image' && camera.liveImageUpdatedAt && Number.isFinite(Date.parse(camera.liveImageUpdatedAt)) && <small>Latest image: <time dateTime={camera.liveImageUpdatedAt}>{new Date(camera.liveImageUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></small>}
      {!compact && <p>{camera.liveMediaKind === 'image' ? 'See the latest camera image on the operator’s website.' : 'Watch this camera on the operator’s website.'}</p>}
    </div>
    <a className="btn btn-primary travel-provider-camera-link" href={playback.url} target="_blank" rel="noopener noreferrer"
      aria-label={`${verified ? camera.liveMediaKind === 'image' ? 'View live image' : 'Watch live' : 'Open camera page'} on ${playback.providerName} for ${camera.city}`}>
      {verified ? camera.liveMediaKind === 'image' ? 'View live image' : 'Watch live' : 'Open camera page'}<ArrowUpRight size={17} aria-hidden="true" />
    </a>
    {!compact && <small>Opens {playback.providerName}</small>}
  </article>;
}
