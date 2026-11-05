// Mirror only the live selfie preview; captures retain the camera's orientation.
export function shouldMirrorCameraPreview(stream) {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;
  const facing = track.getSettings?.().facingMode;
  if (facing) return facing === 'user';
  const modes = track.getCapabilities?.().facingMode;
  if (modes?.length === 1) return modes[0] === 'user';
  // Desktop webcams commonly omit facingMode and still need a selfie preview.
  return true;
}
