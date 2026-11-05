export const TASK_TARGET_LABELS = { api: 'API service', pipeline: 'Pipeline service', web: 'Website', office: 'Office', mobile: 'Mobile app', 'cloudflare-ai': 'Cloudflare AI Worker', 'cloudflare-site': 'Cloudflare Office website' };
export const DEFAULT_TASK_PERMISSIONS = { editCode: true, publish: true, deploy: true, operate: true };
export const DEFAULT_TASK_TARGETS = Object.keys(TASK_TARGET_LABELS);
export const supportsDeploymentApproval = capabilities => capabilities?.deploymentApprovalRequired === true;
export const effectiveTaskPermissions = (permissions, capabilities) => ({
  editCode: permissions.editCode === true,
  publish: supportsDeploymentApproval(capabilities) && permissions.publish === true,
  deploy: supportsDeploymentApproval(capabilities) && permissions.deploy === true,
  operate: supportsDeploymentApproval(capabilities) && permissions.operate === true,
});
export const PREPARATION_ONLY_NOTICE = 'Preparation mode: the server is updating. Publishing, deployment, and Office commands are paused until final approval is supported.';

export default function OfficeAITaskScope({ permissions, setPermissions, targets, setTargets, capabilities, disabled = false, destination = 'full-access' }) {
  const deployTargets = Array.isArray(capabilities?.deployTargets) ? capabilities.deployTargets : [];
  const approvalReady = supportsDeploymentApproval(capabilities), effective = effectiveTaskPermissions(permissions, capabilities);
  return <div className="office-ai-task-scope">
    <fieldset disabled={disabled}><legend>Allowed actions for your requests</legend>{[['editCode', 'Edit code'], ['publish', 'Publish after approval'], ['deploy', 'Deploy after approval'], ['operate', 'Run Office commands']].map(([key,label]) => <label key={key}><input type="checkbox" aria-label={label} checked={effective[key]} disabled={key !== 'editCode' && !approvalReady} onChange={event => setPermissions(previous => ({ ...previous, [key]: event.target.checked, ...(['editCode','deploy'].includes(key) && !event.target.checked ? { publish: false } : {}), ...(key === 'publish' && event.target.checked ? { editCode: true, deploy: true } : {}) }))} />{label}{key !== 'editCode' && !approvalReady ? <small>Available after the server update</small> : capabilities?.[key] === false && <small>Connection required</small>}</label>)}</fieldset>
    <p className="office-ai-form-note">{destination === 'full-access' ? 'Full access uses the checked actions and selected deployment targets to work through your request without repeated routine permission prompts. Unchecked actions stay off.' : 'Sending a request authorizes the checked actions within this destination. Its scope and required confirmations apply.'} {approvalReady ? 'Publishing and deployment always wait for your approval of the prepared version. Publishing starts deployment.' : PREPARATION_ONLY_NOTICE}</p>
    {effective.deploy && !!deployTargets.length && <fieldset disabled={disabled}><legend>Deployment targets</legend>{deployTargets.map(target => { const id = typeof target === 'string' ? target : target.id; return <label key={id}><input type="checkbox" checked={targets.includes(id)} onChange={event => setTargets(previous => event.target.checked ? [...previous,id] : previous.filter(value => value !== id))} />{typeof target === 'string' ? TASK_TARGET_LABELS[id] || id : target.label || target.name || id}</label>; })}</fieldset>}
  </div>;
}
