// The main conversation and voice share the same action boundary.
export function isAgentQuestion(message) {
  const text = String(message || '').trim().toLowerCase().replace(/[.!?]+$/g, '');
  if (/^(?:(?:hi|hello|hey)(?: there| pip)?|good morning|good afternoon|good evening|thanks(?: pip)?|thank you(?: pip)?|ok|okay|yes|no|go|start|run|help|help me|do something|do anything|do nothing|no task|anything|(?:start|run|do) (?:a |the )?task|cancel(?: task)?|stop(?: task)?|never mind|nevermind)$/.test(text)) return true;
  if (/^(?:please )?(?:explain|describe|tell me|help me understand|summarize|compare)\b/.test(text)) return true;
  if (/^(?:what|why|when|where|who|which|how)\b/.test(text)) return true;
  if (/^(?:can|could|would|will) you (?:please )?(?:fix|edit|update|upgrade|build|create|make|write|run|deploy|publish|change|improve|repair|remove|add|save|check|audit|refresh|investigate|test|debug)\b/.test(text)) return false;
  return /^(?:can|could|would|will|do|does|is|are|have|has|should)\b/.test(text);
}

export function isExecutionRequest(message) {
  const text = String(message || '').trim();
  if (isAgentQuestion(text)) return false;
  if (/^(?:please\s+)?(?:do not|don't|never)\b/i.test(text)) return false;
  return /\b(?:fix|repair|debug|edit|update|upgrade|improve|build|run|deploy|publish|release|check|audit|refresh|investigate|implement|test)\b/i.test(text)
    || (/\b(?:create|make|write|change|remove|add|save)\b/i.test(text) && /\b(?:website|site|page|file|code|button|component|endpoint|api|worker|pipeline|memory|tool|app)\b/i.test(text))
    || /\b(?:broken|not working|doesn't work|does not work|keeps failing)\b/i.test(text);
}

export function needsToolSupport(message, files = []) {
  const text = String(message || '').trim();
  if (/^(?:hi|hello|hey|thanks|thank you|what can you do)[.!?]*$/i.test(text)) return false;
  if (files.some(file => /\.(?:csv|tsv)$/i.test(file.name || '') || file.type === 'text/csv')) return true;
  return /\b(?:calculate|compute|solve|median|correlation|compound interest|standard deviation)\b/i.test(text)
    || /\d\s*[-+*/%^]\s*\d/.test(text)
    || /\b(?:analy[sz]e|explore)\b[\s\S]{0,100}\b(?:data|csv|json|table|spreadsheet|statistics)\b/i.test(text)
    || /\b(?:deep|thorough|in.depth|multi.source) research\b/i.test(text)
    || /\bresearch\b[\s\S]{0,100}\b(?:read|inspect)\b[\s\S]{0,40}\b(?:pages|sources)\b/i.test(text)
    || /\b(?:reusable|custom|saved) (?:functions?|extensions?)\b/i.test(text)
    || /\b(?:run|execute|test)\b[\s\S]{0,60}\b(?:functions?|extensions?)\b/i.test(text);
}
