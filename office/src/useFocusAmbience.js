import { useEffect, useRef, useState } from 'react';
import rain from './focus-media/rain.mp3?url';
import orbit from './focus-media/orbit.mp3?url';
import train from './focus-media/train.mp3?url';
import coast from './focus-media/coast.mp3?url';
import { audioSessionType } from './focus-studio-model.mjs';

const TRACKS = { rain, orbit, train, coast };

function getAudioSession() {
  try { return navigator.audioSession ?? null; }
  catch { return null; }
}

function releaseSession(audio) {
  const owned = audio.session;
  audio.session = null;
  try {
    if (owned && owned.session.type === owned.type) owned.session.type = owned.previous;
  } catch { /* Audio Session API is optional. */ }
}

function requestSession(audio, type) {
  const session = getAudioSession();
  if (!session) return false;
  try {
    const owned = audio.session;
    const previous = owned?.session === session && session.type === owned.type ? owned.previous : session.type;
    if (session.type !== type) session.type = type;
    if (session.type !== type) return false;
    audio.session = { session, previous, type };
    return true;
  } catch { return false; }
}

export default function useFocusAmbience(volume, muted, duckSettings, pipSpeaking, quiet, playback) {
  const [scene, setScene] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ducking, setDucking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sessionRejected, setSessionRejected] = useState(false);
  const engine = useRef(null);
  const duckRun = useRef(null);
  const audioSettings = useRef(null);
  audioSettings.current = { volume, muted, quiet, playback, duckSettings };

  function updateGain(audio) {
    const { volume: level, muted: silent, quiet, playback } = audioSettings.current;
    const gain = audio.gain.gain;
    const now = audio.context.currentTime;
    if (quiet || !playback.enabled) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(0, now);
    } else gain.setTargetAtTime(silent ? 0 : level, now, 0.02);
  }

  function syncSession(audio) {
    const { volume, muted, quiet, playback } = audioSettings.current;
    if (!audio.source || quiet || muted || !volume || !playback.enabled) {
      releaseSession(audio);
      setSessionRejected(false);
    } else {
      const applied = requestSession(audio, audioSessionType(playback));
      if (!applied) releaseSession(audio);
      setSessionRejected(!applied && Boolean(getAudioSession()));
    }
  }

  useEffect(() => {
    const audio = engine.current;
    if (!audio) return;
    updateGain(audio);
    syncSession(audio);
  }, [volume, muted, quiet, playback]);

  function envelopeLevel(run, now) {
    if (!run) return 1;
    if (now < run.lowAt) return run.startLevel + (run.target - run.startLevel) * (now - run.start) / (run.lowAt - run.start);
    if (now < run.releaseAt) return run.target;
    if (now < run.end) return run.target + (1 - run.target) * (now - run.releaseAt) / (run.end - run.releaseAt);
    return 1;
  }

  function cancelDucking(audio) {
    const run = duckRun.current;
    if (run) {
      window.clearTimeout(run.timeout);
      duckRun.current = null;
    }
    const now = audio.context.currentTime;
    audio.duck.gain.cancelScheduledValues(now);
    audio.duck.gain.setValueAtTime(1, now);
  }

  function duckAmbience(settings, manual) {
    const audio = engine.current;
    if (audioSettings.current.quiet || !audio?.source) return;
    const start = audio.context.currentTime;
    const prior = duckRun.current;
    if (manual && prior?.end === Infinity) return;
    const startLevel = envelopeLevel(prior, start);
    if (prior) window.clearTimeout(prior.timeout);
    const target = Math.min(startLevel, settings.level / 100);
    const lowAt = start + settings.attackMs / 1000;
    const releaseAt = manual ? lowAt + settings.holdMs / 1000 : Infinity;
    const end = releaseAt + settings.releaseMs / 1000;
    const run = { start, startLevel, target, lowAt, releaseAt, end, manual };
    duckRun.current = run;
    const gain = audio.duck.gain;
    gain.cancelScheduledValues(start);
    gain.setValueAtTime(settings.attackMs ? startLevel : target, start);
    if (settings.attackMs) gain.linearRampToValueAtTime(target, lowAt);
    setDucking(true);
    setPreviewing(manual);
    if (manual) restoreAmbienceAfter(run);
  }

  function restoreAmbienceAfter(run) {
    const audio = engine.current;
    if (!audio || duckRun.current !== run) return;
    const gain = audio.duck.gain;
    gain.setValueAtTime(run.target, run.releaseAt);
    if (run.end === run.releaseAt) gain.setValueAtTime(1, run.end);
    else gain.linearRampToValueAtTime(1, run.end);
    const check = () => {
      if (duckRun.current !== run) return;
      const remaining = (run.end - audio.context.currentTime) * 1000;
      if (remaining > 5 && audio.context.state === 'running') {
        run.timeout = window.setTimeout(check, remaining);
      } else {
        cancelDucking(audio);
        setDucking(false);
        setPreviewing(false);
      }
    };
    run.timeout = window.setTimeout(check, Math.max(0, (run.end - audio.context.currentTime) * 1000));
  }

  function restoreVolume() {
    const audio = engine.current;
    const run = duckRun.current;
    if (!audio?.source || !run?.manual) return;
    const start = audio.context.currentTime;
    const target = envelopeLevel(run, start);
    const end = start + audioSettings.current.duckSettings.releaseMs / 1000;
    window.clearTimeout(run.timeout);
    audio.duck.gain.cancelScheduledValues(start);
    const release = { start, startLevel: target, target, lowAt: start, releaseAt: start, end, manual: false };
    duckRun.current = release;
    setPreviewing(false);
    restoreAmbienceAfter(release);
  }

  useEffect(() => {
    const audio = engine.current;
    if (audioSettings.current.quiet || !audio?.source) return;
    if (pipSpeaking && duckSettings.pip) { duckAmbience(duckSettings, false); return; }
    const run = duckRun.current;
    if (run?.end === Infinity) {
      run.releaseAt = Math.max(run.lowAt, audio.context.currentTime) + duckSettings.holdMs / 1000;
      run.end = run.releaseAt + duckSettings.releaseMs / 1000;
      restoreAmbienceAfter(run);
    }
  }, [pipSpeaking, duckSettings.pip, duckSettings.holdMs, duckSettings.releaseMs, scene, loading]);

  function getEngine() {
    if (engine.current) return engine.current;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('unsupported audio');
    const context = new Audio();
    const gain = context.createGain();
    const duck = context.createGain();
    gain.gain.value = 0;
    gain.connect(duck);
    duck.connect(context.destination);
    const audio = { context, gain, duck, buffers: new Map(), source: null, request: null, session: null };
    engine.current = audio;
    return audio;
  }

  function cancelPlayback(audio, fade = true) {
    audio.request?.abort();
    audio.request = null;
    if (!audio.source) return;
    const { node, gain } = audio.source;
    const now = audio.context.currentTime;
    gain.gain.setTargetAtTime(0, now, 0.014);
    node.stop(now + (fade ? 0.07 : 0));
    audio.source = null;
  }

  function stop(immediate = false) {
    const audio = engine.current;
    if (audio) {
      if (immediate) {
        const now = audio.context.currentTime;
        audio.gain.gain.cancelScheduledValues(now);
        audio.gain.gain.setValueAtTime(0, now);
      }
      cancelPlayback(audio, !immediate);
      cancelDucking(audio);
      releaseSession(audio);
    }
    setDucking(false);
    setPreviewing(false);
    setSessionRejected(false);
    setScene(null);
    setLoading(false);
    setError('');
  }

  useEffect(() => {
    if (quiet || !playback.enabled) stop(true);
  }, [quiet, playback.enabled]);

  useEffect(() => () => {
    const audio = engine.current;
    if (!audio) return;
    engine.current = null;
    cancelPlayback(audio, false);
    cancelDucking(audio);
    releaseSession(audio);
    void audio.context.close().catch(() => {});
  }, []);

  async function play(id) {
    if (audioSettings.current.quiet || !audioSettings.current.playback.enabled || !TRACKS[id] || scene === id) return false;
    setError('');
    let audio;
    let request;
    try {
      audio = getEngine();
      cancelPlayback(audio);

      request = new AbortController();
      audio.request = request;
      setScene(id);
      setLoading(true);
      await audio.context.resume();
      let buffer = audio.buffers.get(id);
      if (!buffer) {
        const response = await fetch(TRACKS[id], { signal: request.signal });
        if (!response.ok) throw new Error('sound unavailable');
        buffer = await audio.context.decodeAudioData(await response.arrayBuffer());
        if (!request.signal.aborted) audio.buffers.set(id, buffer);
      }
      if (request.signal.aborted || audioSettings.current.quiet || !audioSettings.current.playback.enabled
        || engine.current !== audio) return false;

      const node = audio.context.createBufferSource();
      const gain = audio.context.createGain();
      const now = audio.context.currentTime;
      node.buffer = buffer;
      node.loop = true;
      gain.gain.setValueAtTime(0, now);
      gain.gain.setTargetAtTime(1, now, 0.04);
      node.connect(gain);
      gain.connect(audio.gain);
      node.onended = () => { node.disconnect(); gain.disconnect(); };
      node.start(now);
      audio.source = { node, gain };
      syncSession(audio);
      audio.request = null;
      updateGain(audio);
      setLoading(false);
      return true;
    } catch {
      if (request?.signal.aborted) return false;
      if (audio) {
        cancelPlayback(audio, false);
        releaseSession(audio);
      }
      setScene(null);
      setLoading(false);
      setError('This sound couldn’t play. Tap the scene to try again.');
      return false;
    }
  }

  async function previewDuck(id) {
    if (engine.current?.source || await play(id)) duckAmbience(audioSettings.current.duckSettings, true);
  }

  return { scene, loading, error, play, stop, ducking, previewing, previewDuck, restoreVolume,
    sessionAvailable: Boolean(getAudioSession()), sessionRejected };
}
