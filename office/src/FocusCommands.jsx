import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { SCENES } from './FocusAudioControls';
import { FENCE_PROFILES } from './focus-geofence.mjs';
import { AUDIO_MODES, DUCK_PRESETS, DURATIONS, FENCE_SCOPES, matchesDuckingPreset } from './focus-studio-model.mjs';
import { TRACKING_PROFILES } from './focus-tracking.mjs';

function tomorrow() {
  const date = new Date();
  date.setHours(24, 0, 0, 0);
  return +date;
}

export default function FocusCommands({ settings, timer, tracking, monitor, walk, sound, onChange, onQuiet,
  openSection, allowViewBackground }) {
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
      { label: 'Open tracking map', run: () => openSection('tracking'), quick: true },
      { label: 'Walk a route', run: () => walk.open('route'), quick: true, aliases: 'drop pin record path walkthrough' },
      { label: 'Check my location', run: tracking.captureOnce, quick: true, disabled: tracking.capturing || tracking.active && !tracking.paused },
      { label: tracking.active ? 'Stop tracking' : 'Start tracking', run: tracking.active ? tracking.stop : tracking.start, quick: true },
      { label: 'Track location for 30 minutes', run: () => tracking.start(30), disabled: tracking.active },
      { label: tracking.paused ? 'Resume tracking' : 'Pause tracking', run: tracking.paused ? tracking.resume : tracking.pause,
        disabled: !tracking.active },
      { label: 'Update my location', run: tracking.refresh, aliases: 'refresh', disabled: !tracking.active || tracking.paused || !tracking.visible || tracking.refreshing },
      { label: 'Record route', run: tracking.toggleRecording, pressed: tracking.recording, disabled: !tracking.active },
      { label: 'Drop a waypoint', run: () => tracking.addWaypoint(''), disabled: !tracking.fix },
      { label: 'Export current route as GPX', run: tracking.exportRoute, disabled: !tracking.points.length && !tracking.waypoints.length },
      { label: 'Clear current recording', run: tracking.clearRoute, disabled: !tracking.points.length && !tracking.waypoints.length },
      ...Object.entries(TRACKING_PROFILES).map(([id, { label }]) => ({ label: `${label} tracking accuracy`,
        run: () => tracking.setProfile(id), pressed: settings.tracking.profile === id })),
      ...['metric', 'imperial'].map(units => ({ label: `Show ${units} units`, run: () => tracking.setUnits(units),
        pressed: settings.tracking.units === units })),
      ...(allowViewBackground ? [{ label: 'Track while using other Office views', pressed: settings.tracking.background,
        aliases: 'background', run: () => tracking.setBackground(!settings.tracking.background) }] : []),
    ]],
    ['Geofencing', [
      { label: 'Open zone map', run: () => openSection('zones'), quick: true },
      { label: 'Walk a boundary', run: () => walk.open('boundary'), quick: true, aliases: 'drop pin trace fence polygon walkthrough' },
      { label: monitor.active ? 'Stop watching zones' : 'Watch my zones', run: monitor.active ? monitor.stop : monitor.start,
        disabled: !monitor.active && !monitor.monitoredCount, quick: true, aliases: 'start stop monitor geofencing' },
      { label: monitor.paused ? 'Resume watching zones' : 'Pause zone alerts',
        run: monitor.paused ? monitor.resume : () => monitor.pause(), disabled: !monitor.active },
      { label: 'Pause all zones until tomorrow', run: () => monitor.pause(tomorrow()), disabled: !monitor.active },
      { label: 'Check my zones now', run: monitor.refresh, aliases: 'refresh geofence location',
        disabled: !monitor.active || monitor.paused || !monitor.visible || monitor.refreshing },
      ...(allowViewBackground ? [{ label: 'Watch zones while using other Office views', pressed: settings.fence.background,
        aliases: 'background', run: () => monitor.setBackground(!settings.fence.background) }] : []),
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
  const results = groups.map(([group, commands]) => [group, commands.filter(({ label, aliases = '' }) =>
    terms.every(term => `${group} ${label} ${aliases}`.toLowerCase().includes(term)))]).filter(([, commands]) => commands.length);
  const quick = results.flatMap(([, commands]) => commands.filter(command => command.quick));
  function buttons(commands) {
    return <div className="focus-chips">{commands.map(({ label, run, pressed, disabled }) =>
      <button type="button" key={label} className="focus-chip" aria-pressed={pressed} disabled={disabled}
        onClick={() => run()}>{label}</button>)}</div>;
  }

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
        <input type="search" value={search} placeholder="Try “walk” or “pause”" onChange={event => setSearch(event.target.value)} />
      </label>
    </form>
    {sound.error && <p className="focus-error" role="alert">{sound.error}</p>}
    {!results.length && <p className="focus-footnote" role="status">No matching commands.</p>}
    {!query && quick.length > 0 && <div className="focus-command-shortcuts" role="group" aria-label="Map shortcuts">{buttons(quick)}</div>}
    {results.map(([group, commands]) => query
      ? <div key={group} className="focus-command-group" role="group" aria-label={group}><h3>{group}</h3>{buttons(commands)}</div>
      : <details key={group} className="focus-advanced focus-command-group">
        <summary>{group}</summary><div className="focus-advanced-body">{buttons(commands.filter(command => !command.quick))}</div>
      </details>)}
  </section>;
}
