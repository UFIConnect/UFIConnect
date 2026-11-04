const TARGET_LABELS = { api: 'API service', pipeline: 'Pipeline service', web: 'Website', office: 'Office', mobile: 'Mobile app', 'cloudflare-ai': 'Cloudflare AI Worker', 'cloudflare-site': 'Cloudflare Office website' };
export const DEFAULT_TASK_PERMISSIONS = { editCode: true, publish: true, deploy: true, operate: true };

export default function OfficeAITaskScope({ permissions, setPermissions, targets, setTargets, capabilities, disabled = false }) {
  const deployTargets = Array.isArray(capabilities?.deployTargets) ? capabilities.deployTargets : [];
  return <div className="office-ai-task-scope">
    <fieldset disabled={disabled}><legend>Allowed actions for your requests</legend>{[['editCode', 'Edit code'], ['publish', 'Publish changes'], ['deploy', 'Deploy requested changes'], ['operate', 'Run Office commands']].map(([key,label]) => <label key={key}><input type="checkbox" checked={permissions[key]} onChange={event => setPermissions(previous => ({ ...previous, [key]: event.target.checked, ...(['editCode','deploy'].includes(key) && !event.target.checked ? { publish: false } : {}), ...(key === 'publish' && event.target.checked ? { editCode: true, deploy: true } : {}) }))} />{label}{capabilities?.[key] === false && <small>Connection required</small>}</label>)}</fieldset>
    <p className="office-ai-form-note">Sending a request authorizes these actions as needed to complete it. Publishing can trigger deployment. Destructive commands keep their required confirmation.</p>
    {permissions.deploy && !!deployTargets.length && <fieldset disabled={disabled}><legend>Deployment targets</legend>{deployTargets.map(target => { const id = typeof target === 'string' ? target : target.id; return <label key={id}><input type="checkbox" checked={targets.includes(id)} onChange={event => setTargets(previous => event.target.checked ? [...previous,id] : previous.filter(value => value !== id))} />{typeof target === 'string' ? TARGET_LABELS[id] || id : target.label || target.name || id}</label>; })}</fieldset>}
  </div>;
}
