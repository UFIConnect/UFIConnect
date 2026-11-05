// Questions and small talk stay conversational even inside an execution agent.
// Selecting Work still controls whether a concrete action can create a task.
export function isAgentQuestion(message) {
  const text = String(message || '').trim().toLowerCase().replace(/[.!?]+$/g, '');
  if (/^(?:(?:hi|hello|hey)(?: there| pip)?|good morning|good afternoon|good evening|thanks(?: pip)?|thank you(?: pip)?|ok|okay|yes|no|go|start|run|help|help me|do something|do anything|do nothing|no task|anything|(?:start|run|do) (?:a |the )?task|cancel(?: task)?|stop(?: task)?|never mind|nevermind)$/.test(text)) return true;
  if (/^(?:please )?(?:explain|describe|tell me|help me understand|summarize|compare)\b/.test(text)) return true;
  if (/^(?:what|why|when|where|who|which|how)\b/.test(text)) return true;
  if (/^(?:can|could|would|will) you (?:please )?(?:fix|edit|update|upgrade|build|create|make|write|run|deploy|publish|change|improve|repair|remove|add|save)\b/.test(text)) return false;
  return /^(?:can|could|would|will|do|does|is|are|have|has|should)\b/.test(text);
}
