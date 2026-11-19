import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowRight, Brain, Compass, Footprints, Headphones, ListChecks, Map, MapPin, Moon, Navigation, Pause, Play, RotateCcw, SlidersHorizontal, Timer, Volume2, VolumeX } from 'lucide-react';
import { Ambience, FocusDucking } from './FocusAudioControls';
import FocusCommands from './FocusCommands';
import FocusCommandOptions from './FocusCommandOptions';
import FocusLocation from './FocusLocation';
import FocusLiveTools from './FocusLiveTools';
import { FocusBody, FocusPractice } from './FocusPractice';
import FocusZone from './FocusZone';
import FocusPhoneSync from './FocusPhoneSync';
import FocusDeviceDesk, { FocusShield } from './FocusDeviceDesk';
import useFocusDeviceHealth from './useFocusDeviceHealth';
import useOfficeFocus from './useOfficeFocus';
import { FENCE_PROFILES } from './focus-geofence.mjs';
import { automaticCommandAllowed, chooseBoundaryRule, clockText, createFocusPin, DURATIONS, readFocusSettings, saveFocusSettings, zoneLabel } from './focus-studio-model.mjs';
import { downloadFocusFile, exportTrip, TRACKING_PROFILES } from './focus-tracking.mjs';
import useFocusAmbience from './useFocusAmbience';
import useFocusLocation from './useFocusLocation';
import useFocusLiveDevices from './useFocusLiveDevices';
import useFocusMovement from './useFocusMovement';
import './FocusStudio.css';

const SECTIONS = [
  { id: 'session', label: 'Session', icon: Timer },
  { id: 'tracking', label: 'Geo Tracking', shortLabel: 'Track', icon: Navigation },
  { id: 'live-maps', label: 'Live Maps', shortLabel: 'Maps', icon: Map },
  { id: 'zones', label: 'Geofencing', shortLabel: 'Fences', icon: MapPin },
  { id: 'sound', label: 'Sound', icon: Headphones },
  { id: 'practice', label: 'Practice', icon: Brain },
  { id: 'commands', label: 'Commands', shortLabel: 'Actions', icon: ListChecks },
];
const MAP_SECTIONS = SECTIONS.filter(section => section.id === 'tracking' || section.id === 'zones');

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

export default function FocusStudio({ active, mapsOnly = false, onOpen, pipSpeaking, onQuietChange, liveTransport, focusRequest, authScope = null, initialSection = 'session', allowViewBackground = true }) {
  const [settings, setSettings] = useState(readFocusSettings);
  const sync = useOfficeFocus(focusRequest, authScope, active && !mapsOnly);
  const phoneMonitoring = Boolean(sync.snapshot?.phone?.scopes.zones);
  const phoneSession = sync.snapshot?.session;
  const phoneOwner = sync.snapshot?.ownerId;
  const phoneId = sync.snapshot?.phone?.id;
  const monitoredPhone = useRef(null);
  const [audioEnabledAt, setAudioEnabledAt] = useState(0);
  const lastAudio = useRef(null);
  const audioConsent = useRef(false);
  const [phoneAudioError, setPhoneAudioError] = useState('');
  const [studioSection, setStudioSection] = useState(initialSection);
  const [mapSection, setMapSection] = useState('tracking');
  const [pickingPin, setPickingPin] = useState(false);
  const section = mapsOnly ? mapSection : studioSection;
  const setSection = mapsOnly ? setMapSection : setStudioSection;
  const [seconds, setSeconds] = useState(() => settings.minutes * 60);
  const [deadline, setDeadline] = useState(null);
  const [started, setStarted] = useState(false);
  const [notice, setNotice] = useState('');
  const [focusShield, setFocusShield] = useState('');
  const [breakDeadline, setBreakDeadline] = useState(null);
  const endBreak = () => phoneMonitoring ? void sync.command('endReset') : setBreakDeadline(null);
  const effectiveQuiet = settings.quiet || Boolean(focusShield);
  const audioBlocked = effectiveQuiet || !settings.audio.enabled;
  const audio = useFocusAmbience(settings.volume, settings.muted, settings.duck, pipSpeaking, effectiveQuiet, settings.audio);
  useEffect(() => { onQuietChange?.(effectiveQuiet); }, [effectiveQuiet, onQuietChange]);

  const updateSettings = useCallback(changes => setSettings(current => ({
    ...current, ...(typeof changes === 'function' ? changes(current) : changes),
  })), []);
  useEffect(() => saveFocusSettings(settings), [settings]);
  useEffect(() => {
    const previous = monitoredPhone.current;
    monitoredPhone.current = phoneMonitoring ? { authScope, owner: phoneOwner, id: phoneId } : null;
    // Apply the final shared session once when this account's phone stops.
    const samePhone = previous && previous.authScope === authScope && previous.owner === phoneOwner && previous.id === phoneId;
    if (!phoneSession || (!phoneMonitoring && !samePhone)) return;
    const at = Date.now(), finish = phoneSession.deadline ?? null;
    if (typeof phoneSession.remaining === 'number') {
      setStarted(Boolean(phoneSession.started && (!finish || finish > at)));
      setDeadline(finish > at ? finish : null);
      setSeconds(finish ? Math.max(0, Math.ceil((finish - at) / 1000)) : phoneSession.remaining);
    }
    if (Object.hasOwn(phoneSession, 'breakDeadline')) {
      setBreakDeadline(phoneSession.breakDeadline > at ? phoneSession.breakDeadline : null);
    }
    if (typeof phoneSession.quiet === 'boolean') {
      updateSettings({ quiet: phoneSession.quiet });
    }
  }, [phoneSession?.deadline, phoneSession?.remaining, phoneSession?.started, phoneSession?.breakDeadline,
    phoneSession?.quiet, phoneMonitoring, phoneOwner, phoneId, authScope, updateSettings, onQuietChange]);
  useEffect(() => {
    audioConsent.current = false;
    setAudioEnabledAt(0);
  }, [authScope, phoneOwner, phoneId]);

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
    if (phoneMonitoring) { void sync.command(quiet ? 'quiet' : 'quietOff'); return; }
    updateSettings({ quiet });
  }

  function pauseWork() {
    if (deadline === null) return false;
    if (phoneMonitoring) { void sync.command('pauseTimer'); return true; }
    setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    setDeadline(null);
    return true;
  }

  function startWork({ sound = settings.sessionAmbience } = {}) {
    if (breakDeadline !== null) return false;
    if (phoneMonitoring) {
      void sync.command('start');
      if (sound && !audioBlocked && !settings.muted) void audio.play(settings.scene);
      return true;
    }
    setNotice('');
    const duration = seconds || settings.minutes * 60;
    setSeconds(duration);
    setStarted(true);
    setDeadline(Date.now() + duration * 1000);
    if (sound && !audioBlocked && !settings.muted) void audio.play(settings.scene);
    return true;
  }

  function resetWork(minutes) {
    if (phoneMonitoring) { void sync.command('resetTimer'); return; }
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
    if (phoneMonitoring) return;
    if (focusShield) {
      tracking.recordDiagnostic('FOCUS_RULE_LOGGED', `${events.length} boundary event(s) recorded. Automatic actions suppressed during ${focusShield} focus.`);
      return;
    }
    const { type, action, area } = chooseBoundaryRule(settings, events);
    const movement = {
      enter: `You entered ${area}.`, exit: `You left ${area}.`,
      stay: `You stayed inside ${area}.`, approach: `You’re approaching ${area}.`,
    }[type];
    const result = executeZoneAction(action, type);
    setNotice(result ? `${movement} ${result}` : movement);
  }

  const executeZoneAction = useEffectEvent((action, type) => {
    if (focusShield || !automaticCommandAllowed(settings, action)) return '';
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
    return commands[action]?.();
  });

  const { tracking, monitor: browserMonitor, walk } = useFocusLocation(settings, active, boundaryChange, deadline !== null, Boolean(focusShield));
  const deviceHealth = useFocusDeviceHealth(active, tracking.visible);
  const stopBrowserMonitor = browserMonitor.stop;
  useEffect(() => { if (phoneMonitoring && browserMonitor.active) stopBrowserMonitor(); }, [phoneMonitoring, browserMonitor.active, stopBrowserMonitor]);
  const monitor = phoneMonitoring ? { ...browserMonitor, phoneMonitoring, start: () => {
    setNotice('Stop zone sharing on your phone to switch back to browser monitoring.');
  } } : browserMonitor;

  const audioCommand = sync.snapshot?.audio;
  const deliverAudio = useEffectEvent(async id => {
    const result = await sync.claimAudio(id);
    if (result && !document.hidden && audioConsent.current) executeZoneAction(result.action);
  });
  useEffect(() => {
    if (!audioCommand || !audioEnabledAt || audioCommand.at < audioEnabledAt || document.hidden
      || sync.status.busy || lastAudio.current === audioCommand.id) return;
    lastAudio.current = audioCommand.id;
    void deliverAudio(audioCommand.id);
  }, [audioCommand, audioEnabledAt, sync.status.busy]);

  async function togglePhoneAudio() {
    if (audioEnabledAt) { setAudioEnabledAt(0); audioConsent.current = false; return; }
    try { await audio.unlock(); audioConsent.current = true; setAudioEnabledAt(Date.now()); setPhoneAudioError(''); }
    catch { setPhoneAudioError('This browser blocked phone-triggered audio.'); }
  }
  const devices = useFocusLiveDevices(liveTransport, tracking);
  const liveTools = useFocusMovement(tracking, devices, settings.commands.enabled);
  function startDeviceFocus(mode) {
    audio.stop(true);
    audioConsent.current = false;
    setAudioEnabledAt(0);
    tracking.recordDiagnostic('DISTRACTION_FREE_STARTED', `${mode} focus started. Office sound and local automatic boundary actions are suppressed.`);
    setFocusShield(mode);
  }
  function endDeviceFocus() {
    tracking.recordDiagnostic('DISTRACTION_FREE_ENDED', 'Distraction-free focus ended. Your saved Quiet Mode setting still applies.');
    setFocusShield('');
  }
  const map = {
    mapMode: settings.mapMode,
    setMapMode: mapMode => updateSettings({ mapMode }),
    showStreets: settings.streets,
    setShowStreets: streets => updateSettings({ streets }),
  };
  function openWalk(mode) {
    const target = walk.state?.mode ?? mode;
    walk.open(target);
    if (target === 'route') setPickingPin(false);
    setSection(target === 'route' ? 'tracking' : 'zones');
  }
  const walkTools = { ...walk, open: openWalk };
  const canRestoreSound = audio.held || audio.previewing;

  function startTracking(minutes) {
    tracking.start(minutes);
    setSection('tracking');
  }

  function startGeofencing() {
    monitor.start();
    setSection('zones');
  }

  const activePinIds = phoneMonitoring ? sync.snapshot.phone.registered ?? []
    : browserMonitor.active ? browserMonitor.monitoredIds : [];

  function addPin(center) {
    const id = crypto.randomUUID();
    updateSettings(current => ({ zones: [...current.zones, createFocusPin(id, center, current.radius, current.zones)] }));
  }

  function savePin(id, changes) {
    updateSettings(current => ({
      zones: current.zones.map(zone => zone.id === id ? { ...zone, ...changes } : zone),
    }));
    if (phoneMonitoring && activePinIds.includes(id)) {
      setNotice('Review zone changes under Phone monitoring to update the paired phone.');
    }
  }

  function reviewPhonePins() {
    setNotice('Review zone changes under Phone monitoring to apply this change to the paired phone.');
    setStudioSection('zones');
    if (mapsOnly) onOpen?.();
  }

  function activatePin(id, enabled) {
    updateSettings(current => {
      const group = enabled && current.fence.scope !== 'selected' && current.fence.group;
      return {
        zones: current.zones.map(zone => zone.id === id ? { ...zone, enabled, ...(group && { group }) } : zone),
        ...(enabled && { activeZoneId: id }),
      };
    });
    if (phoneMonitoring) reviewPhonePins();
    else if (enabled) browserMonitor.startPin();
  }

  function removePin(id) {
    updateSettings(current => ({
      zones: current.zones.filter(zone => zone.id !== id),
      activeZoneId: current.activeZoneId === id ? null : current.activeZoneId,
    }));
    if (phoneMonitoring && activePinIds.includes(id)) reviewPhonePins();
  }

  function updateTracking(changes) {
    if (changes.timeStop === false) tracking.clearTimeStop();
    if (changes.distanceStop === false) tracking.clearDistanceStop();
    updateSettings(current => ({ tracking: { ...current.tracking, ...changes } }));
  }

  function setTrackingProfile(profile) {
    if (profile !== settings.tracking.profile) updateTracking({ profile, interval: TRACKING_PROFILES[profile].interval });
  }

  function exportCurrentRoute() {
    const { data, mime } = exportTrip('gpx', { name: 'Office trip', points: tracking.points, waypoints: tracking.waypoints });
    downloadFocusFile(data, 'office-trip.gpx', mime);
  }

  function updateFence(changes) {
    updateSettings(current => ({ fence: { ...current.fence, ...changes } }));
  }

  function setAccuracy(profile) {
    if (profile !== settings.fence.profile) updateFence({ profile, seconds: FENCE_PROFILES[profile].defaultSeconds });
  }

  function startBreak() {
    if (breakDeadline !== null) return false;
    if (phoneMonitoring) { void sync.command('bodyReset'); return true; }
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
      {focusShield ? <FocusShield mode={focusShield} tracking={tracking} devices={devices} health={deviceHealth}
        vehicle={liveTools.state.vehicle} seconds={seconds} onExit={endDeviceFocus} /> : <>
      <header className="focus-header">
        <div className="focus-header-icon"><Compass size={28} aria-hidden="true" /></div>
        {mapsOnly ? <div><h1>Location maps</h1></div> : <>
          <div><h1>Focus Studio</h1><p>{settings.quiet
            ? onQuietChange ? 'Office audio is silent.' : 'Soundscapes are silent.'
            : 'Work sessions, soundscapes, and location rules.'}</p></div>
          {quietButton}
        </>}
      </header>
      <nav className="focus-studio-nav" data-maps-only={mapsOnly || undefined} aria-label={mapsOnly ? 'Location maps' : 'Focus Studio sections'}>
        {(mapsOnly ? MAP_SECTIONS : SECTIONS).map(({ id, label, shortLabel, icon: Icon }) => <button key={id} type="button" aria-label={label}
          aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
          <Icon size={17} aria-hidden="true" />
          <span className={shortLabel && !mapsOnly ? 'focus-nav-label' : undefined}>{label}</span>
          {shortLabel && !mapsOnly && <span className="focus-nav-short-label" aria-hidden="true">{shortLabel}</span>}
        </button>)}
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
          <button type="button" className="focus-quick-action" onClick={() => setSection('live-maps')}><Map size={18} aria-hidden="true" />
            <span>Open live maps</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" disabled={walk.state?.mode === 'route'}
            onClick={() => { setPickingPin(true); setSection('tracking'); }}><MapPin size={18} aria-hidden="true" />
            <span>Drop a pin</span><ArrowRight size={16} aria-hidden="true" /></button>
          <button type="button" className="focus-quick-action" onClick={() => setSection('zones')}><MapPin size={18} aria-hidden="true" />
            <span>Manage geofences<small>{monitor.active ? 'Geofencing on' : monitor.selected ? zoneLabel(monitor.selected) : 'No zone selected'}</small></span>
            <ArrowRight size={16} aria-hidden="true" /></button>
        </section>
      </div>
      {active && section === 'session' && !mapsOnly && <FocusDeviceDesk tracking={tracking} devices={devices}
        health={deviceHealth} onFocus={startDeviceFocus} />}
      {active && section === 'tracking' && <FocusLocation tracking={tracking} preferences={settings.tracking}
        onChange={updateTracking} onProfile={setTrackingProfile} allowViewBackground={allowViewBackground}
        walk={walkTools} map={map} devices={devices} pinTools={{
          pins: settings.zones.filter(zone => zone.pin), activeIds: activePinIds, onPhone: phoneMonitoring,
          paused: browserMonitor.paused, add: addPin, save: savePin, activate: activatePin, remove: removePin,
        }}
        pickingPin={pickingPin} setPickingPin={setPickingPin} />}
      {active && section === 'live-maps' && <FocusLiveTools tools={liveTools} devices={devices} tracking={tracking}
        map={map} units={settings.tracking.units} />}
      <div hidden={section !== 'zones'}>
        {!mapsOnly && focusRequest && <FocusPhoneSync sync={sync} settings={settings} officeAccess={authScope !== null}
          audioEnabledAt={audioEnabledAt} onToggleAudio={togglePhoneAudio} audioError={phoneAudioError || audio.error} />}
        <FocusZone settings={settings} updateSettings={updateSettings} monitor={monitor}
        deviceFix={active && section === 'zones' ? tracking.fix ?? monitor.status?.fix : null}
        updateFence={updateFence} onAccuracy={setAccuracy} allowViewBackground={allowViewBackground}
        walk={walkTools} map={map} mapVisible={active && section === 'zones'} defaultName={mapsOnly ? 'Zone' : undefined} /></div>
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
      {section === 'commands' && <><FocusCommandOptions settings={settings} onChange={updateSettings}
        phoneMonitoring={phoneMonitoring} onReviewPhone={() => setSection('zones')} />
      <FocusCommands settings={settings} onChange={updateSettings} onQuiet={setQuiet} openSection={setSection}
        walk={walkTools} allowViewBackground={allowViewBackground}
        timer={{ phase, resting, start: () => startWork(), pause: pauseWork, reset: () => resetWork(settings.minutes),
          duration: setDuration, takeBreak, endBreak }}
        tracking={{ ...tracking, start: startTracking, refresh: () => { tracking.refresh(); setSection('tracking'); },
          captureOnce: () => { tracking.captureOnce(); setSection('tracking'); },
          setBackground: background => updateTracking({ background }), setProfile: setTrackingProfile,
          setUnits: units => updateTracking({ units }), exportRoute: exportCurrentRoute }}
        monitor={{ ...monitor, start: startGeofencing, refresh: () => { monitor.refresh(); setSection('zones'); },
          setAccuracy, setScope: scope => updateFence({ scope }), setBackground: background => updateFence({ background }) }}
        sound={{ ...audio, setScene, setDucking: updateDucking, setPlayback: updatePlayback, withPip: Boolean(onQuietChange) }} /></>}
      </>}
    </div>
    {!active && (isRunning || audio.scene || resting || effectiveQuiet || tracking.active || monitor.active || devices.viewing || notice) && <aside className="focus-compact" aria-label="Focus session">
      <button type="button" className="focus-button" onClick={onOpen}><Compass size={16} aria-hidden="true" />Focus Studio
        {isRunning && <span className="focus-compact-clock">{clockText(seconds)}</span>}
      </button>
      {!focusShield && quietButton}
      {focusShield && <button type="button" className="focus-button" onClick={endDeviceFocus}>End distraction-free focus</button>}
      {tracking.active && <button type="button" className="focus-button" onClick={tracking.stop}>
        <Navigation size={16} aria-hidden="true" />Stop Geo Tracking</button>}
      {monitor.active && <button type="button" className="focus-button" onClick={monitor.stop}>
        <MapPin size={16} aria-hidden="true" />Stop Geofencing</button>}
      {devices.sharing && <button type="button" className="focus-button" onClick={devices.stopSharing}>Stop sharing GPS</button>}
      {devices.viewing && <button type="button" className="focus-button" onClick={() => {
        if (liveTools.state.sourceId) liveTools.selectSource('');
        devices.stopViewing();
      }}>Stop viewing shared GPS</button>}
      {!focusShield && notice && <span role="status">{notice}</span>}
      {!focusShield && resting && <span>Body reset in progress</span>}
      {isRunning && <button type="button" className="focus-button focus-icon-button" aria-label="Pause work timer"
        onClick={pauseWork}><Pause size={17} aria-hidden="true" /></button>}
    </aside>}
  </>;
}
