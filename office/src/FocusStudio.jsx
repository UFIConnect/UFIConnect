import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Brain, Compass, Footprints, Headphones, ListChecks, MapPin, Moon, Navigation, Pause, Play, RotateCcw, SlidersHorizontal, Timer, Volume2, VolumeX } from 'lucide-react';
import { Ambience, FocusDucking } from './FocusAudioControls';
import FocusCommands from './FocusCommands';
import FocusLocation from './FocusLocation';
import { FocusBody, FocusPractice } from './FocusPractice';
import FocusZone from './FocusZone';
import { FENCE_PROFILES } from './focus-geofence.mjs';
import { chooseBoundaryRule, clockText, DURATIONS, readFocusSettings, saveFocusSettings, zoneLabel } from './focus-studio-model.mjs';
import useFocusAmbience from './useFocusAmbience';
import useFocusLocation from './useFocusLocation';
import './FocusStudio.css';

const SECTIONS = [
  { id: 'session', label: 'Session', icon: Timer },
  { id: 'tracking', label: 'Geo Tracking', icon: Navigation },
  { id: 'zones', label: 'Geofencing', icon: MapPin },
  { id: 'sound', label: 'Sound', icon: Headphones },
  { id: 'practice', label: 'Practice', icon: Brain },
  { id: 'commands', label: 'Commands', icon: ListChecks },
];

function WorkTimer({ minutes, seconds, phase, resting, onToggle, onDuration, onReset }) {
  const running = phase === 'running';
  const progress = 1 - seconds / (minutes * 60);
  const label = running ? 'Pause focus' : phase === 'paused' ? 'Resume focus' : 'Start focus';
  return <section className="focus-card focus-work" aria-labelledby="focus-work-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Timer size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-work-title">Work timer</h2><p>Choose a work interval.</p></div>
    </div>
    <div className="focus-clock-row">
      <div className="focus-clock-ring">
        <svg viewBox="0 0 176 176" aria-hidden="true">
          <circle cx="88" cy="88" r="78" className="focus-clock-track" />
          <circle cx="88" cy="88" r="78" pathLength="100" strokeDasharray={`${Math.max(0, progress * 100)} 100`}
            transform="rotate(-90 88 88)" className="focus-clock-progress" />
        </svg>
        <div><output role="timer" aria-label="Work time remaining">{clockText(seconds)}</output>
          <span>{{ running: 'In session', complete: 'Complete', ready: 'Ready', paused: 'Paused' }[phase]}</span></div>
      </div>
      <div className="focus-work-controls">
        <div className="focus-chips" role="group" aria-label="Work timer duration">
          {DURATIONS.map(value => <button key={value} className="focus-chip" type="button" aria-pressed={minutes === value}
            disabled={running || resting} onClick={() => onDuration(value)}>{value}m</button>)}
        </div>
        <div className="focus-actions">
          <button type="button" className="focus-button focus-primary" onClick={onToggle} disabled={resting}>
            {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {resting ? 'Body reset in progress' : label}
          </button>
          <button type="button" className="focus-button focus-icon-button" onClick={onReset}
            title="Reset work timer" aria-label="Reset work timer"><RotateCcw size={17} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  </section>;
}

export default function FocusStudio({ active, onOpen, pipSpeaking, onQuietChange }) {
  const [settings, setSettings] = useState(readFocusSettings);
  const [section, setSection] = useState('session');
  const [seconds, setSeconds] = useState(() => settings.minutes * 60);
  const [deadline, setDeadline] = useState(null);
  const [started, setStarted] = useState(false);
  const [notice, setNotice] = useState('');
  const [breakDeadline, setBreakDeadline] = useState(null);
  const endBreak = useCallback(() => setBreakDeadline(null), []);
  const audioBlocked = settings.quiet || !settings.audio.enabled;
  const audio = useFocusAmbience(settings.volume, settings.muted, settings.duck, pipSpeaking, settings.quiet, settings.audio);

  const updateSettings = useCallback(changes => setSettings(current => ({
    ...current, ...(typeof changes === 'function' ? changes(current) : changes),
  })), []);
  useEffect(() => saveFocusSettings(settings), [settings]);

  useEffect(() => {
    if (deadline === null) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining > 0) return;
      setDeadline(null);
      setNotice(settings.bodyReminders ? 'Work interval complete. Ready for a body reset.' : 'Work interval complete.');
    };
    tick();
    const interval = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [deadline, settings.bodyReminders]);

  function setQuiet(quiet) {
    if (quiet) audio.stop(true);
    updateSettings({ quiet });
    onQuietChange?.(quiet);
  }

  function pauseWork() {
    if (deadline === null) return false;
    setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    setDeadline(null);
    return true;
  }

  function startWork({ sound = settings.sessionAmbience } = {}) {
    if (breakDeadline !== null) return false;
    setNotice('');
    const duration = seconds || settings.minutes * 60;
    setSeconds(duration);
    setStarted(true);
    setDeadline(Date.now() + duration * 1000);
    if (sound && !audioBlocked && !settings.muted) void audio.play(settings.scene);
    return true;
  }

  function resetWork(minutes) {
    setDeadline(null);
    setSeconds(minutes * 60);
    setStarted(false);
    setNotice('');
  }

  function startZoneTimer({ sound = false, resumeOnly = false } = {}) {
    const paused = started && seconds > 0;
    if (deadline !== null || (resumeOnly && !paused) || !startWork({ sound })) return '';
    return paused ? 'Timer resumed.' : 'Timer started.';
  }

  function boundaryChange(events) {
    const { type, action, area } = chooseBoundaryRule(settings, events);
    const movement = type === 'enter' ? `You entered ${area}.` : `You left ${area}.`;
    const commands = {
      start: () => startZoneTimer(),
      resume: () => startZoneTimer({ resumeOnly: true }),
      startWithSound: () => startZoneTimer({ sound: true }),
      pauseTimer: () => pauseWork() && 'Timer paused.',
      pause: () => { pauseWork(); audio.stop(); return 'Timer and ambience paused.'; },
      resetTimer: () => { resetWork(settings.minutes); return 'Timer reset.'; },
      bodyReset: () => startBreak() && 'Body reset started.',
      endReset: () => {
        if (breakDeadline === null) return '';
        endBreak();
        return 'Body reset ended.';
      },
      playSound: () => {
        if (!audioBlocked && !settings.muted && !audio.scene) void audio.play(settings.scene);
      },
      stopSound: () => { audio.stop(); return 'Soundscape stopped.'; },
      muteSound: () => { updateSettings({ muted: true }); return 'Soundscape muted.'; },
      unmuteSound: () => { updateSettings({ muted: false }); return 'Soundscape unmuted.'; },
      duckSound: () => audio.duckNow() && 'Soundscape ducking.',
      holdSound: () => audio.duckNow('hold') && 'Soundscape ducking held.',
      restoreSound: () => audio.restoreVolume() && 'Manual ducking released.',
      quiet: () => {
        if (type === 'exit') pauseWork();
        setQuiet(true);
        return 'Quiet Mode is on.';
      },
      quietOff: () => { setQuiet(false); return 'Quiet Mode is off.'; },
      stopTracking: () => { monitor.stop(); return 'Geofencing stopped.'; },
    };
    const result = commands[action]?.();
    setNotice(result ? `${movement} ${result}` : movement);
  }

  const { tracking, monitor } = useFocusLocation(settings, active, boundaryChange);
  const canRestoreSound = audio.held || audio.previewing;

  function startTracking() {
    tracking.start();
    setSection('tracking');
  }

  function startGeofencing() {
    monitor.start();
    setSection('zones');
  }

  function updateTrackingBackground(background) {
    updateSettings({ tracking: { background } });
  }

  function updateFence(changes) {
    updateSettings(current => ({ fence: { ...current.fence, ...changes } }));
  }

  function setAccuracy(profile) {
    if (profile !== settings.fence.profile) updateFence({ profile, seconds: FENCE_PROFILES[profile].defaultSeconds });
  }

  function startBreak() {
    if (breakDeadline !== null) return false;
    pauseWork();
    setNotice('');
    setBreakDeadline(Date.now() + 60000);
    return true;
  }

  function takeBreak() {
    startBreak();
    setSection('practice');
  }

  function toggleSound() {
    if (audioBlocked) return;
    if (audio.scene) audio.stop();
    else void audio.play(settings.scene);
  }

  function setScene(scene) {
    updateSettings({ scene });
    if (audio.scene && !audioBlocked) void audio.play(scene);
  }

  function updateDucking(changes) {
    updateSettings(current => ({ duck: { ...current.duck, ...changes } }));
  }

  function updatePlayback(changes) {
    if (changes.enabled === false) audio.stop(true);
    updateSettings(current => ({ audio: { ...current.audio, ...changes } }));
  }

  function setDuration(minutes) {
    updateSettings({ minutes });
    resetWork(minutes);
  }

  const isRunning = deadline !== null;
  const resting = breakDeadline !== null;
  const phase = isRunning ? 'running' : seconds === 0 ? 'complete' : started ? 'paused' : 'ready';
  const quietButton = <button type="button" className="focus-quiet-button" aria-pressed={settings.quiet}
    onClick={() => setQuiet(!settings.quiet)}>
    <Moon size={19} aria-hidden="true" /><span>Quiet Mode<small>{settings.quiet ? 'On' : 'Off'}</small></span>
    <i aria-hidden="true" />
  </button>;

  return <>
    <div className="focus-studio" hidden={!active}>
      <header className="focus-header">
        <div className="focus-header-icon"><Compass size={28} aria-hidden="true" /></div>
        <div><h1>Focus Studio</h1><p>{settings.quiet
          ? onQuietChange ? 'Office audio is silent.' : 'Soundscapes are silent.'
          : 'Work sessions, soundscapes, and location rules.'}</p></div>
        {quietButton}
      </header>
      <nav className="focus-studio-nav" aria-label="Focus Studio sections">
        {SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined}
          onClick={() => setSection(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}
      </nav>
      <p className="focus-feedback focus-session-status" role="status">{notice}</p>
      <div hidden={section !== 'session'} className="focus-grid">
        <WorkTimer minutes={settings.minutes} seconds={seconds} phase={phase} resting={resting}
          onToggle={() => isRunning ? pauseWork() : startWork()}
          onDuration={setDuration}
          onReset={() => resetWork(settings.minutes)} />
        <section className="focus-card focus-quick" aria-labelledby="focus-quick-title">
          <div className="focus-card-heading">
            <span className="focus-icon"><Compass size={18} aria-hidden="true" /></span>
            <div><h2 id="focus-quick-title">Quick actions</h2><p>One tap while you work.</p></div>
          </div>
          <button type="button" className="focus-quick-action" onClick={takeBreak}><Footprints size={18} aria-hidden="true" />
            <span>{resting ? 'Return to body reset' : 'Take a one-minute reset'}</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={toggleSound} disabled={audioBlocked}>
            {audio.scene ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
            <span>{audio.scene ? 'Stop soundscape' : 'Play soundscape'}</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action"
            disabled={!canRestoreSound && (!audio.scene || audio.loading || audioBlocked || settings.muted || settings.volume === 0)}
            onClick={() => canRestoreSound ? audio.restoreVolume() : audio.duckNow()}>
            <SlidersHorizontal size={18} aria-hidden="true" /><span>{canRestoreSound ? 'Restore soundscape volume' : 'Duck soundscape'}</span>
            <ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={tracking.active ? tracking.stop : startTracking}>
            <Navigation size={18} aria-hidden="true" /><span>{tracking.active ? 'Stop Geo Tracking' : 'Start Geo Tracking'}</span>
            <ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={() => setSection('zones')}><MapPin size={18} aria-hidden="true" />
            <span>Manage geofences<small>{monitor.active ? 'Geofencing on' : monitor.selected ? zoneLabel(monitor.selected) : 'No zone selected'}</small></span>
            <ArrowRight size={16} aria-hidden="true" /></button>
        </section>
      </div>
      {active && section === 'tracking' && <FocusLocation tracking={tracking} background={settings.tracking.background}
        onBackgroundChange={updateTrackingBackground} />}
      <div hidden={section !== 'zones'}><FocusZone settings={settings} updateSettings={updateSettings} monitor={monitor}
        deviceFix={active && section === 'zones' ? tracking.fix ?? monitor.status?.fix : null}
        updateFence={updateFence} onAccuracy={setAccuracy} /></div>
      <div hidden={section !== 'sound'} className="focus-grid">
        <Ambience audio={audio} settings={settings} updateSettings={updateSettings} onPlay={toggleSound} onScene={setScene} />
        <FocusDucking audio={audio} settings={settings.duck} playback={settings.audio} scene={settings.scene}
          audible={!audioBlocked && !settings.muted && settings.volume > 0} withPip={Boolean(onQuietChange)}
          onChange={updateDucking} onPlayback={updatePlayback} />
      </div>
      <div hidden={section !== 'practice'} className="focus-grid">
        <FocusBody reminders={settings.bodyReminders} reminder={phase === 'complete' && settings.bodyReminders}
          onReminderChange={bodyReminders => updateSettings({ bodyReminders })} end={breakDeadline} onEnd={endBreak} onTakeBreak={takeBreak} />
        <FocusPractice />
      </div>
      {section === 'commands' && <FocusCommands settings={settings} onChange={updateSettings} onQuiet={setQuiet} openSection={setSection}
        timer={{ phase, resting, start: () => startWork(), pause: pauseWork, reset: () => resetWork(settings.minutes),
          duration: setDuration, takeBreak, endBreak }}
        tracking={{ ...tracking, start: startTracking, refresh: () => { tracking.refresh(); setSection('tracking'); },
          setBackground: updateTrackingBackground }}
        monitor={{ ...monitor, start: startGeofencing, refresh: () => { monitor.refresh(); setSection('zones'); },
          setAccuracy, setScope: scope => updateFence({ scope }), setBackground: background => updateFence({ background }) }}
        sound={{ ...audio, setScene, setDucking: updateDucking, setPlayback: updatePlayback, withPip: Boolean(onQuietChange) }} />}
    </div>
    {!active && (isRunning || audio.scene || resting || settings.quiet || tracking.active || monitor.active || notice) && <aside className="focus-compact" aria-label="Focus session">
      <button type="button" className="focus-button" onClick={onOpen}><Compass size={16} aria-hidden="true" />Focus Studio
        {isRunning && <span className="focus-compact-clock">{clockText(seconds)}</span>}
      </button>
      {quietButton}
      {tracking.active && <button type="button" className="focus-button" onClick={tracking.stop}>
        <Navigation size={16} aria-hidden="true" />Stop Geo Tracking</button>}
      {monitor.active && <button type="button" className="focus-button" onClick={monitor.stop}>
        <MapPin size={16} aria-hidden="true" />Stop Geofencing</button>}
      {notice && <span role="status">{notice}</span>}
      {resting && <span>Body reset in progress</span>}
      {isRunning && <button type="button" className="focus-button focus-icon-button" aria-label="Pause work timer"
        onClick={pauseWork}><Pause size={17} aria-hidden="true" /></button>}
    </aside>}
  </>;
}
