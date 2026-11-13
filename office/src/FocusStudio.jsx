import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Brain, Compass, Footprints, Headphones, MapPin, Moon, Pause, Play, RotateCcw, Timer, Volume2, VolumeX } from 'lucide-react';
import { Ambience, FocusDucking } from './FocusAudioControls';
import { FocusBody, FocusPractice } from './FocusPractice';
import FocusZone from './FocusZone';
import { clockText, DURATIONS, readFocusSettings, saveFocusSettings, zoneLabel } from './focus-studio-model.mjs';
import useFocusAmbience from './useFocusAmbience';
import useFocusGeofence from './useFocusGeofence';
import './FocusStudio.css';

const SECTIONS = [
  { id: 'session', label: 'Session', icon: Timer },
  { id: 'zones', label: 'Zones', icon: MapPin },
  { id: 'sound', label: 'Sound', icon: Headphones },
  { id: 'practice', label: 'Practice', icon: Brain },
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
  const audio = useFocusAmbience(settings.volume, settings.muted, settings.duck, pipSpeaking, settings.quiet);

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
    if (deadline === null) return;
    setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    setDeadline(null);
  }

  function startWork({ sound = false } = {}) {
    if (breakDeadline !== null) return false;
    setNotice('');
    const duration = seconds || settings.minutes * 60;
    setSeconds(duration);
    setStarted(true);
    setDeadline(Date.now() + duration * 1000);
    if (sound && settings.sessionAmbience && !settings.quiet && !settings.muted) void audio.play(settings.scene);
    return true;
  }

  function resetWork(minutes) {
    setDeadline(null);
    setSeconds(minutes * 60);
    setStarted(false);
    setNotice('');
  }

  function boundaryChange(type) {
    if (type === 'exit') {
      if (settings.fence.exit !== 'status') {
        pauseWork();
        if (settings.fence.exit === 'quiet') setQuiet(true);
        else audio.stop();
      }
      setNotice({ status: 'You left the monitored area.', pause: 'Timer and ambience paused at the boundary.',
        quiet: 'You left the monitored area. Quiet Mode is on.' }[settings.fence.exit]);
      return;
    }
    if (settings.fence.enter === 'quiet') {
      setQuiet(true);
      setNotice('You entered the monitored area. Quiet Mode is on.');
    } else if (settings.fence.enter === 'resume' && started && seconds > 0 && deadline === null && startWork()) {
      setNotice('Timer resumed inside the monitored area.');
    } else setNotice('You entered the monitored area.');
  }

  const monitor = useFocusGeofence(settings, boundaryChange);

  function takeBreak() {
    if (breakDeadline !== null) { setSection('practice'); return; }
    pauseWork();
    setNotice('');
    setSection('practice');
    setBreakDeadline(Date.now() + 60000);
  }

  function toggleSound() {
    if (settings.quiet) return;
    if (audio.scene) audio.stop();
    else void audio.play(settings.scene);
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
          onToggle={() => isRunning ? pauseWork() : startWork({ sound: true })}
          onDuration={minutes => { updateSettings({ minutes }); resetWork(minutes); }}
          onReset={() => resetWork(settings.minutes)} />
        <section className="focus-card focus-quick" aria-labelledby="focus-quick-title">
          <div className="focus-card-heading">
            <span className="focus-icon"><Compass size={18} aria-hidden="true" /></span>
            <div><h2 id="focus-quick-title">Quick actions</h2><p>One tap while you work.</p></div>
          </div>
          <button type="button" className="focus-quick-action" onClick={takeBreak}><Footprints size={18} aria-hidden="true" />
            <span>{resting ? 'Return to body reset' : 'Take a one-minute reset'}</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={toggleSound} disabled={settings.quiet}>
            {audio.scene ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
            <span>{audio.scene ? 'Stop soundscape' : 'Play soundscape'}</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={() => setSection('zones')}><MapPin size={18} aria-hidden="true" />
            <span>Manage focus zones<small>{monitor.active ? 'Monitoring on' : monitor.selected ? zoneLabel(monitor.selected) : 'No zone selected'}</small></span>
            <ArrowRight size={16} aria-hidden="true" /></button>
        </section>
      </div>
      <div hidden={section !== 'zones'}><FocusZone settings={settings} updateSettings={updateSettings} monitor={monitor} /></div>
      <div hidden={section !== 'sound'} className="focus-grid">
        <Ambience audio={audio} settings={settings} updateSettings={updateSettings} onPlay={toggleSound} />
        <FocusDucking audio={audio} settings={settings.duck} audible={!settings.quiet && !settings.muted && settings.volume > 0}
          withPip={Boolean(onQuietChange)} onChange={changes => updateSettings(current => ({ duck: { ...current.duck, ...changes } }))} />
      </div>
      <div hidden={section !== 'practice'} className="focus-grid">
        <FocusBody reminders={settings.bodyReminders} reminder={phase === 'complete' && settings.bodyReminders}
          onReminderChange={bodyReminders => updateSettings({ bodyReminders })} end={breakDeadline} onEnd={endBreak} onTakeBreak={takeBreak} />
        <FocusPractice />
      </div>
    </div>
    {!active && (isRunning || audio.scene || resting || settings.quiet || monitor.active || notice) && <aside className="focus-compact" aria-label="Focus session">
      <button type="button" className="focus-button" onClick={onOpen}><Compass size={16} aria-hidden="true" />Focus Studio
        {isRunning && <span className="focus-compact-clock">{clockText(seconds)}</span>}
      </button>
      {quietButton}
      {notice && <span role="status">{notice}</span>}
      {resting && <span>Body reset in progress</span>}
      {isRunning && <button type="button" className="focus-button focus-icon-button" aria-label="Pause work timer"
        onClick={pauseWork}><Pause size={17} aria-hidden="true" /></button>}
    </aside>}
  </>;
}
