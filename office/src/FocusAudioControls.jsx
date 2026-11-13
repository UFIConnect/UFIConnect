import { CloudRain, Headphones, Moon, Pause, Play, SlidersHorizontal, TrainFront, Volume2, VolumeX, Waves } from 'lucide-react';
import { DUCK_FIELDS } from './focus-studio-model.mjs';
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
  return <section className="focus-card focus-ambience" aria-labelledby="focus-ambience-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Headphones size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-ambience-title">Soundscapes</h2><p>Choose what you hear while you work.</p></div>
    </div>
    <div className="focus-scene-feature" style={{ backgroundImage: `linear-gradient(90deg, #101324ee, #10132438 100%), url("${featured.artwork}")` }}>
      <div><strong>{featured.name}</strong><span>{featured.description}</span></div>
      <button type="button" className="focus-scene-play" onClick={onPlay} disabled={settings.quiet}
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
        disabled={settings.quiet} onClick={() => updateSettings({ muted: !settings.muted })}>
        {settings.muted || settings.quiet ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      </button>
      <label className="focus-slider focus-volume">
        <span>Ambience volume</span><output>{settings.quiet || settings.muted ? 'Muted' : `${Math.round(settings.volume * 100)}%`}</output>
        <input type="range" aria-label="Ambience volume" min="0" max="100" value={Math.round(settings.volume * 100)}
          disabled={settings.quiet} aria-valuetext={`${Math.round(settings.volume * 100)} percent`}
          onChange={event => updateSettings({ volume: Number(event.target.value) / 100, muted: false })} />
      </label>
    </div>
    <label className="focus-check"><input type="checkbox" checked={settings.sessionAmbience}
      onChange={event => updateSettings({ sessionAmbience: event.target.checked })} />Play ambience during work sessions</label>
    {settings.quiet && <p className="focus-footnote">Quiet Mode is on. Turn it off to play a soundscape.</p>}
    {audio.loading && <p className="focus-feedback" role="status">Loading audio…</p>}
    {audio.error && <p className="focus-error" role="alert">{audio.error}</p>}
  </section>;
}

export function FocusDucking({ audio, settings, audible, withPip, onChange }) {
  return <section className="focus-card focus-ducking" aria-labelledby="focus-ducking-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><SlidersHorizontal size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-ducking-title">Audio ducking</h2><p>Choose how far and how fast ambience fades.</p></div>
    </div>
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
      <button type="button" className="focus-button" onClick={audio.previewDuck}
        disabled={!audible || !audio.scene || audio.loading}>Preview ducking</button>
      {audio.ducking && <span className="focus-feedback" role="status">Ambience lowered</span>}
    </div>
  </section>;
}
