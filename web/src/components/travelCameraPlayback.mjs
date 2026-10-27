export function providerCameraPlayback(camera) {
  const playback = camera?.livePlayback;
  if (playback?.kind !== 'provider' || playback.url !== camera.sourceUrl || !playback.providerName) return null;
  try {
    const url = new URL(playback.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return { url: url.href, providerName: String(playback.providerName).slice(0, 160) };
  } catch { return null; }
}

export function providerCameraStatus(camera) {
  if (camera?.liveVerified && camera.providerStatus === 'live') {
    if (camera.liveMediaKind === 'image') {
      const interval = Number(camera.liveUpdateIntervalSeconds);
      return interval > 0 ? `Live camera image · updates every ${interval % 60 === 0 ? `${interval / 60} minute${interval === 60 ? '' : 's'}` : `${interval} seconds`}` : 'Live camera image';
    }
    return 'Live on provider';
  }
  return ({ offline: 'The operator reports this camera offline.', checking: 'Checking the camera’s current status.', unavailable: 'Current camera status could not be checked.' })[camera?.providerStatus]
    || 'Camera page available. Live status is not confirmed.';
}
