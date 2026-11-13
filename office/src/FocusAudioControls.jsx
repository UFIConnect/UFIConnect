import { CloudRain, Headphones, Moon, Pause, Play, SlidersHorizontal, TrainFront, Volume2, VolumeX, Waves } from 'lucide-react';
import { AUDIO_MODES, DUCK_FIELDS } from './focus-studio-model.mjs';
import rainArt from './focus-media/rain.webp';
import orbitArt from './focus-media/orbit.webp';
import trainArt from './focus-media/train.webp';
import coastArt from './focus-media/coast.webp';

export const SCENES = [
  { id: 'rain', name: 'Rain on glass', description: 'Soft rain and a distant, warm chord.', artwork: rainArt, icon: CloudRain },
  { id: 'orbit', name: 'Low orbit', description: 'An airy hum and a slowly moving chord.', artwork: orbitArt, icon: Moon },
  { id: 'train', name: 'Night train', description: 'A low carriage rumble and gentle rail rhythm.', artwork: trainArt, icon: TrainFront },
  { id: 'coast', name: 'Dusk coast', description: 'Rolling surf with a soft tonal bed.', artwork: coastArt, icon: Waves },
];
const LABELS = { attackMs: 'Fade down', holdMs: 'Hold', releaseMs: 'Fade up', level: 'Remaining volume' };
const PRESETS = [
  { name: 'Gentle', attackMs: 300, holdMs: 800, releaseMs: 800, level: 55 },
  { name: 'Balanced', attackMs: 180, holdMs: 900, releaseMs: 400, level: 30 },
  { name: 'Deep', attackMs: 80, holdMs: 1200, releaseMs: 650, level: 5 },
];

export function Ambience({ audio, settings, updateSettings, onPlay }) {
  const featured = SCENES.find(scene => scene.id === settings.scene);
  const blocked = settings.quiet || !settings.audio.enabled;
  return <section className="focus-card focus-ambience" aria-labelledby="focus-ambience-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Headphones size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-ambience-title">Soundscapes</h2><p>Choose what you hear while you work.</p></div>
    </div>
    <div className="focus-scene-feature" style={{ backgroundImage: `linear-gradient(90deg, #101324ee, #10132438 100%), url("${featured.artwork}")` }}>
      <div><strong>{featured.name}</strong><span>{featured.description}</span></div>
      <button type="button" className="focus-scene-play" onClick={onPlay} disabled={blocked}
        aria-label={`${audio.scene ? 'Stop' : 'Play'} ${featured.name}`}>
        {audio.scene ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}
      </button>
    </div>
    <div className="focus-scenes" role="group" aria-label="Ambient scenes">
      {SCENES.map(scene => <button type="button" key={scene.id} aria-pressed={settings.scene === scene.id}
        className="focus-chip" onClick={() => {
          updateSettings({ scene: scene.id });
          if (audio.scene && !settings.quiet) void audio.play(scene.id);
        }}><scene.icon size={15} aria-hidden="true" />{scene.name}</button>)}
    </div>
    <div className="focus-mix">
      <button type="button" className="focus-button focus-icon-button" aria-label={settings.muted ? 'Unmute ambience' : 'Mute ambience'}
        disabled={blocked} onClick={() => updateSettings({ muted: !settings.muted })}>
        {settings.muted || settings.quiet ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      </button>
      <label className="focus-slider focus-volume">
        <span>Ambience volume</span><output>{blocked || settings.muted ? 'Muted' : `${Math.round(settings.volume * 100)}%`}</output>
        <input type="range" aria-label="Ambience volume" min="0" max="100" value={Math.round(settings.volume * 100)}
          disabled={blocked} aria-valuetext={`${Math.round(settings.volume * 100)} percent`}
          onChange={event => updateSettings({ volume: Number(event.target.value) / 100, muted: false })} />
      </label>
    </div>
    <label className="focus-check"><input type="checkbox" checked={settings.sessionAmbience}
      onChange={event => updateSettings({ sessionAmbience: event.target.checked })} />Play ambience during work sessions</label>
    {settings.quiet && <p className="focus-footnote">Quiet Mode is on. Turn it off to play a soundscape.</p>}
    {!settings.quiet && !settings.audio.enabled && <p className="focus-footnote">Turn on Enable Audio in Audio Ducking to play a soundscape.</p>}
    {audio.loading && <p className="focus-feedback" role="status">Loading audio…</p>}
    {audio.error && <p className="focus-error" role="alert">{audio.error}</p>}
  </section>;
}

export function FocusDucking({ audio, settings, playback, scene, audible, withPip, onChange, onPlayback }) {
  const browserModes = audio.sessionAvailable;
  const canPlaySilent = browserModes && playback.mode === 'exclusive';
  return <section className="focus-card focus-ducking" aria-labelledby="focus-ducking-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><SlidersHorizontal size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-ducking-title">Audio ducking</h2><p>Set playback rules and ambience fade timing.</p></div>
    </div>
    <div className="focus-audio-modes">
      <div className="focus-actions">
        <button type="button" className="focus-chip" aria-pressed={playback.enabled}
          onClick={() => onPlayback({ enabled: !playback.enabled })}>Enable Audio</button>
        <button type="button" className="focus-chip" aria-pressed={canPlaySilent && playback.silent}
          disabled={!playback.enabled || !canPlaySilent}
          onClick={() => onPlayback({ silent: !playback.silent })}>Play in Silent Mode</button>
      </div>
      <div className="focus-chips" role="group" aria-label="Interruption mode">
        {AUDIO_MODES.map(({ id, label }) => <button type="button" key={id} className="focus-chip"
          aria-pressed={(browserModes ? playback.mode : 'mix') === id}
          disabled={!playback.enabled || (!browserModes && id !== 'mix')}
          onClick={() => onPlayback({ mode: id })}>{label}</button>)}
      </div>
      <p className="focus-footnote">{browserModes
        ? 'Silent Mode uses Do Not Mix. Your device decides whether to lower or pause other apps.'
        : 'This browser supports soundscapes and ambience ducking. Other-app controls and Silent Mode require browser audio-session support.'}</p>
      {audio.sessionRejected && <p className="focus-feedback" role="status">This browser didn’t accept the selected audio mode.</p>}
    </div>
    <h3 className="focus-audio-subtitle">Ambience fades</h3>
    <div className="focus-chips" role="group" aria-label="Ducking presets">
      {PRESETS.map(({ name, ...preset }) => <button type="button" className="focus-chip" key={name}
        aria-pressed={Object.keys(preset).every(key => preset[key] === settings[key])}
        onClick={() => onChange(preset)}>{name}</button>)}
    </div>
    <div className="focus-duck-fields">
      {Object.entries(DUCK_FIELDS).map(([field, { min, max, step }]) => {
        const value = settings[field];
        const isLevel = field === 'level';
        const label = isLevel ? LABELS[field] : `${LABELS[field]} (ms)`;
        return <label className="focus-slider" key={field}>
          <span>{label}</span><output>{value}{isLevel ? '%' : ' ms'}</output>
          <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
            aria-valuetext={isLevel ? `${value} percent` : `${value} milliseconds`}
            onChange={event => onChange({ [field]: Number(event.target.value) })} />
        </label>;
      })}
    </div>
    {withPip && <label className="focus-check"><input type="checkbox" checked={settings.pip}
      onChange={event => onChange({ pip: event.target.checked })} />Lower ambience while Pip speaks</label>}
    <div className="focus-actions">
      <button type="button" className="focus-button" onClick={() => void audio.previewDuck(scene)}
        disabled={!audible || audio.loading}>Preview ducking</button>
      <button type="button" className="focus-button" onClick={audio.restoreVolume}
        disabled={!audible || !audio.previewing}>Restore volume</button>
      {audio.ducking && audible && <span className="focus-feedback" role="status">Ambience ducking</span>}
    </div>
  </section>;
}
