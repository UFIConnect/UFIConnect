import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { SCENES } from './FocusAudioControls';
import { FENCE_PROFILES } from './focus-geofence.mjs';
import { AUDIO_MODES, DUCK_PRESETS, DURATIONS, FENCE_SCOPES, matchesDuckingPreset } from './focus-studio-model.mjs';

export default function FocusCommands({ settings, timer, monitor, sound, onChange, onQuiet, openSection }) {
  const [search, setSearch] = useState('');
  const enabled = settings.audio.enabled;
  const blocked = !enabled || settings.quiet;
  const audible = !blocked && !settings.muted && settings.volume > 0;
  const canRestore = sound.held || sound.previewing;
  const canPlaySilent = sound.sessionAvailable && settings.audio.mode === 'exclusive';
  const groups = [
    ['Timer and practice', [
      { label: 'Start timer', run: timer.start, disabled: timer.resting || !['ready', 'complete'].includes(timer.phase) },
      { label: 'Pause timer', run: timer.pause, disabled: timer.phase !== 'running' },
      { label: 'Resume timer', run: timer.start, disabled: timer.resting || timer.phase !== 'paused' },
      { label: 'Reset timer', run: timer.reset },
      ...DURATIONS.map(minutes => ({ label: `Set timer to ${minutes} minutes`, run: () => timer.duration(minutes),
        pressed: settings.minutes === minutes, disabled: timer.resting || timer.phase === 'running' })),
      { label: 'Start a one-minute reset', run: timer.takeBreak, disabled: timer.resting },
      { label: 'End body reset', run: timer.endBreak, disabled: !timer.resting },
      { label: 'Body reset reminders', pressed: settings.bodyReminders, run: () => onChange({ bodyReminders: !settings.bodyReminders }) },
      { label: 'Open focus exercises', run: () => openSection('practice') },
    ]],
    ['Geo Tracking', [
      { label: 'Start Geo Tracking', run: monitor.start, disabled: monitor.active || !monitor.monitoredCount },
      { label: 'Stop Geo Tracking', run: monitor.stop, disabled: !monitor.active },
      { label: 'Refresh location', run: monitor.refresh, disabled: !monitor.active || !monitor.visible || monitor.refreshing },
      { label: 'Open zone map', run: () => openSection('zones') },
      { label: 'Clear crossing activity', run: monitor.clearEvents, disabled: !monitor.events.length },
      ...Object.entries(FENCE_PROFILES).map(([id, { label }]) => ({ label: `${label} accuracy`,
        run: () => monitor.setAccuracy(id), pressed: settings.fence.profile === id })),
      ...FENCE_SCOPES.map(({ id, label }) => ({ label: `Track ${label.toLowerCase()}`,
        run: () => monitor.setScope(id), pressed: settings.fence.scope === id })),
    ]],
    ['Soundscapes', [
      { label: 'Play soundscape', run: () => sound.play(settings.scene), disabled: blocked || Boolean(sound.scene) },
      { label: 'Stop soundscape', run: () => sound.stop(), disabled: !sound.scene },
      { label: settings.muted ? 'Unmute ambience' : 'Mute ambience',
        run: () => onChange({ muted: !settings.muted }), disabled: blocked },
      { label: 'Increase ambience volume', run: () => onChange({ volume: Math.min(1, (Math.round(settings.volume * 100) + 10) / 100), muted: false }),
        disabled: blocked || settings.volume === 1 },
      { label: 'Decrease ambience volume', run: () => onChange({ volume: Math.max(0, (Math.round(settings.volume * 100) - 10) / 100), muted: false }),
        disabled: blocked || settings.volume === 0 },
      { label: 'Play ambience during work sessions', pressed: settings.sessionAmbience,
        run: () => onChange({ sessionAmbience: !settings.sessionAmbience }) },
      ...SCENES.map(({ id, name }) => ({ label: name, pressed: settings.scene === id, run: () => sound.setScene(id) })),
    ]],
    ['Audio ducking', [
      { label: 'Preview ducking', run: () => sound.previewDuck(settings.scene), disabled: !audible || sound.loading || sound.held },
      { label: 'Hold ducking', run: () => sound.held ? sound.restoreVolume() : sound.previewDuck(settings.scene, 'hold'),
        pressed: sound.held, disabled: !sound.held && (!audible || sound.loading) },
      { label: 'Restore volume', run: sound.restoreVolume, disabled: !canRestore },
      ...DUCK_PRESETS.map(({ name, ...preset }) => ({ label: `${name} ducking`,
        pressed: matchesDuckingPreset(settings.duck, preset), run: () => sound.setDucking(preset) })),
      ...(sound.withPip ? [{ label: 'Duck ambience while Pip speaks', pressed: settings.duck.pip,
        run: () => sound.setDucking({ pip: !settings.duck.pip }) }] : []),
      { label: 'Open ducking controls', run: () => openSection('sound') },
    ]],
    ['Playback and Quiet Mode', [
      { label: settings.quiet ? 'Turn off Quiet Mode' : 'Turn on Quiet Mode', run: () => onQuiet(!settings.quiet) },
      { label: 'Enable Audio', pressed: enabled, run: () => sound.setPlayback({ enabled: !enabled }) },
      ...AUDIO_MODES.map(({ id, label }) => ({ label, run: () => sound.setPlayback({ mode: id }),
        pressed: (sound.sessionAvailable ? settings.audio.mode : 'mix') === id,
        disabled: !enabled || (!sound.sessionAvailable && id !== 'mix') })),
      { label: 'Play in Silent Mode', run: () => sound.setPlayback({ silent: !settings.audio.silent }),
        pressed: canPlaySilent && settings.audio.silent, disabled: !enabled || !canPlaySilent },
    ]],
  ];
  const query = search.trim().toLowerCase();
  const terms = query.split(/\s+/);
  const results = groups.map(([group, commands]) => [group, commands.filter(({ label }) =>
    terms.every(term => `${group} ${label}`.toLowerCase().includes(term)))]).filter(([, commands]) => commands.length);

  return <section className="focus-card focus-commands" aria-labelledby="focus-commands-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><ListChecks size={18} aria-hidden="true" /></span>
      <h2 id="focus-commands-title">Focus commands</h2>
    </div>
    <form role="search" aria-label="Focus commands" onSubmit={event => {
      event.preventDefault();
      const commands = results.flatMap(([, commands]) => commands);
      const command = commands.find(({ label }) => label.toLowerCase() === query) ?? (commands.length === 1 ? commands[0] : null);
      if (command && !command.disabled) command.run();
    }}>
      <label className="focus-select">Search commands
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
    </form>
    {sound.error && <p className="focus-error" role="alert">{sound.error}</p>}
    {!results.length && <p className="focus-footnote" role="status">No matching commands.</p>}
    {results.map(([group, commands]) => <div key={group} className="focus-command-group" role="group" aria-label={group}>
      <h3>{group}</h3>
      <div className="focus-chips">
        {commands.map(({ label, run, pressed, disabled }) => <button type="button" key={label} className="focus-chip"
          aria-pressed={pressed} disabled={disabled} onClick={() => run()}>{label}</button>)}
      </div>
    </div>)}
  </section>;
}
