import { AUTOMATIC_COMMANDS } from './focus-studio-model.mjs';

const GROUPS = [
  ['Timer & resets', ['start', 'resume', 'startWithSound', 'pauseTimer', 'pause', 'resetTimer', 'bodyReset', 'endReset']],
  ['Sound & Quiet Mode', ['playSound', 'stopSound', 'muteSound', 'unmuteSound', 'duckSound', 'holdSound', 'restoreSound', 'quiet', 'quietOff']],
  ['Monitoring', ['stopTracking']],
];

export default function FocusCommandOptions({ settings, onChange, phoneMonitoring, onReviewPhone }) {
  const commands = settings.commands;
  const enabled = commands.enabled;
  const change = changes => onChange({ commands: { ...commands, ...changes } });
  return <section className="focus-card focus-command-options" aria-labelledby="focus-automatic-title">
    <div className="focus-card-heading"><div><h2 id="focus-automatic-title">Automatic commands</h2>
      <p>Switch actions off without deleting your saved rules.</p></div></div>
    <label className="focus-toggle-row"><span><strong>Allow automatic commands</strong>
      <small>Boundary actions and repeat messages in this Office session.</small></span>
      <input type="checkbox" role="switch" checked={enabled} onChange={event => change({ enabled: event.target.checked })} /></label>
    <p className="focus-footnote" role="status">{enabled ? 'Only enabled commands can run.' : 'Automatic commands are off. GPS and boundary observation continue; manual controls still work.'}</p>
    {GROUPS.map(([label, ids]) => <details key={label} className="focus-advanced">
      <summary>{label}</summary><div className="focus-advanced-body focus-command-toggles">
        {AUTOMATIC_COMMANDS.filter(command => ids.includes(command.id)).map(({ id, label: name }) =>
          <label className="focus-toggle-row" key={id}><span>{name}</span>
            <input type="checkbox" role="switch" aria-label={`Allow automatic ${name.toLowerCase()}`}
              checked={commands.actions[id]} disabled={!enabled} onChange={event =>
                change({ actions: { ...commands.actions, [id]: event.target.checked } })} /></label>)}
      </div>
    </details>)}
    {phoneMonitoring && <p className="focus-footnote">A paired phone keeps its last applied rules. <button type="button"
      className="focus-text-button" onClick={onReviewPhone}>Review and apply phone rules</button></p>}
  </section>;
}
