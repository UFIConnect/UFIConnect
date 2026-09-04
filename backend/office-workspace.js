const ALLOWED_OFFICE_WORKSPACES = new Set(['decision-foundry']);
const MAX_OFFICE_WORKSPACE_BYTES = 400 * 1024;

function normalizeOfficeWorkspaceKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return ALLOWED_OFFICE_WORKSPACES.has(key) ? key : null;
}

function validateOfficeWorkspacePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Workspace payload must be an object.' };
  }
  if (!Array.isArray(payload.decisions)) {
    return { valid: false, error: 'Workspace payload must include a decisions array.' };
  }
  if (payload.decisions.length > 200) {
    return { valid: false, error: 'Workspace payload cannot contain more than 200 decisions.' };
  }
  const malformedDecision = payload.decisions.some((decision) => (
    !decision || typeof decision !== 'object' || Array.isArray(decision) ||
    typeof decision.id !== 'string' || !Array.isArray(decision.criteria) || !Array.isArray(decision.options)
  ));
  if (malformedDecision) {
    return { valid: false, error: 'Workspace contains an invalid decision record.' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { valid: false, error: 'Workspace payload must be valid JSON.' };
  }

  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_OFFICE_WORKSPACE_BYTES) {
    return {
      valid: false,
      error: `Workspace payload exceeds the ${MAX_OFFICE_WORKSPACE_BYTES}-byte limit.`,
    };
  }

  return { valid: true, bytes };
}

module.exports = {
  MAX_OFFICE_WORKSPACE_BYTES,
  normalizeOfficeWorkspaceKey,
  validateOfficeWorkspacePayload,
};
