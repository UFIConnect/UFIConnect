import client from '../api/client';

export const LIVE_API = '/get-ready-with-us';
export const liveSessionPath = id => `${LIVE_API}/sessions/${id}`;
export const liveViewerPath = (sessionId, viewerId) => `${liveSessionPath(sessionId)}/viewers/${viewerId}`;
export const closeLiveConnection = path => client.delete(path, { timeout: 5000, fetchOptions: { keepalive: true } }).catch(() => {});

async function gatherDescription(peer, description, signal) {
  signal.throwIfAborted();
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete' && !signal.aborted) {
    await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onState);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const onState = () => { if (peer.iceGatheringState === 'complete' || peer.signalingState === 'closed') finish(); };
      // SDP carries the gathered ICE candidates in one exchange. A network
      // that blocks one of the ICE transports must still be able to try the others.
      const timer = setTimeout(finish, 6500);
      peer.addEventListener('icegatheringstatechange', onState);
      signal.addEventListener('abort', finish, { once: true });
      onState();
    });
  }
  signal.throwIfAborted();
  return peer.localDescription.sdp;
}

function poll(signal, request, onError) {
  let timer;
  async function tick() {
    if (signal.aborted) return;
    let next;
    try { next = await request(); }
    catch (error) { if (!signal.aborted) next = onError(error); }
    if (!signal.aborted && next) timer = setTimeout(tick, next);
  }
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  void tick();
}

const cannotContinue = error => [401, 403, 404].includes(error?.response?.status);

export function broadcastLive({ session, iceServers }, stream, signal, { onViewers, onReconnect, onEnd }) {
  const peers = new Map();
  let lastSync = Date.now();
  const countViewers = () => onViewers([...peers.values()].filter(peer => peer.connectionState === 'connected').length);
  function removePeer(id) {
    const peer = peers.get(id);
    peers.delete(id);
    peer?.removeEventListener('connectionstatechange', countViewers);
    peer?.close();
  }
  signal.addEventListener('abort', () => {
    for (const id of peers.keys()) removePeer(id);
  }, { once: true });

  async function answerViewer(viewer) {
    const peer = new window.RTCPeerConnection({ iceServers });
    peers.set(viewer.id, peer);
    peer.addEventListener('connectionstatechange', countViewers);
    try {
      await peer.setRemoteDescription({ type: 'offer', sdp: viewer.offer });
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      const answer = await gatherDescription(peer, await peer.createAnswer(), signal);
      if (peers.get(viewer.id) !== peer) return;
      await client.put(`${liveViewerPath(session.id, viewer.id)}/answer`, { answer }, { signal, timeout: 6000 });
    } catch {
      if (peers.get(viewer.id) === peer) removePeer(viewer.id);
    }
  }

  poll(signal, async () => {
    const { data } = await client.post(`${liveSessionPath(session.id)}/host`, {}, { signal, timeout: 7000 });
    if (signal.aborted) return;
    lastSync = Date.now();
    const present = new Set(data.viewers.map(viewer => viewer.id));
    for (const id of peers.keys()) if (!present.has(id)) removePeer(id);
    for (const viewer of data.viewers) {
      if (!viewer.answered && !peers.has(viewer.id)) void answerViewer(viewer).catch(() => {});
    }
    countViewers();
    onReconnect(false);
    return 2200;
  }, error => {
    if (cannotContinue(error)) return onEnd('This live session has ended.');
    if (Date.now() - lastSync > 45_000) return onEnd('The connection was lost. Start a new live session to continue.');
    onReconnect(true);
    return 2600;
  });
}

export async function watchLive(path, iceServers, signal, { onStream, onStatus, onEnd }) {
  signal.throwIfAborted();
  const peer = new window.RTCPeerConnection({ iceServers });
  const media = new window.MediaStream();
  let connectingSince = Date.now();
  let lastSync = Date.now();
  signal.addEventListener('abort', () => {
    peer.close();
    media.getTracks().forEach(track => track.stop());
  }, { once: true });
  peer.ontrack = ({ track }) => {
    if (signal.aborted) return;
    media.addTrack(track);
    onStream(media);
  };
  peer.onconnectionstatechange = () => {
    if (signal.aborted) return;
    if (peer.connectionState === 'connected') {
      connectingSince = null;
      onStatus('watching');
    } else if (peer.connectionState === 'disconnected') {
      connectingSince ??= Date.now();
      onStatus('reconnecting');
    } else if (peer.connectionState === 'failed') onEnd('The video connection dropped. Try joining again.');
  };
  peer.addTransceiver('video', { direction: 'recvonly' });
  peer.addTransceiver('audio', { direction: 'recvonly' });
  const offer = await gatherDescription(peer, await peer.createOffer(), signal);
  poll(signal, async () => {
    const { data } = await client.put(path, peer.remoteDescription ? {} : { offer }, { signal, timeout: 7000 });
    if (signal.aborted) return;
    lastSync = Date.now();
    if (data.answer && !peer.remoteDescription) await peer.setRemoteDescription({ type: 'answer', sdp: data.answer });
    if (connectingSince !== null && Date.now() - connectingSince > 30_000) return onEnd('Couldn’t connect to the host. Try joining again.');
    return peer.connectionState === 'connected' ? 6500 : 1400;
  }, error => {
    if (cannotContinue(error)) return onEnd('This live session has ended or is no longer available.');
    if (connectingSince !== null && Date.now() - connectingSince > 30_000) return onEnd('Couldn’t connect to the host. Try joining again.');
    if (Date.now() - lastSync > 45_000) return onEnd('The connection was lost. Try joining again.');
    return 2300;
  });
}
