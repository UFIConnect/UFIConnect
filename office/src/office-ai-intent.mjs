// The main conversation and voice share the same action boundary.
const ACTION = /^(?:fix|repair|debug|edit|update|upgrade|improve|build|run|deploy|publish|release|check|audit|refresh|investigate|implement|test|enable|disable|activate|deactivate|optimize|sync|transfer|drain|execute|pause|resume|restart|connect|disconnect|clear|delete|restore|create|make|write|change|remove|add|save|set|increase|reduce|finish|complete|manage|adjust|configure|maintain|resolve|refactor|organize|customi[sz]e|apply)\b/i;
const ACTION_OBJECT = /\b(?:uficonnect(?:\.(?:ai|org))?|pip|assistant|website|site|page|file|code|button|component|endpoint|api|worker|pipeline|memory|tool|app|tasks?|jobs?|recovery|attempts?|retr(?:y|ies)|permissions?|approvals?|timeouts?|limits?|settings?|services?|sources?|agents?|controls?)\b/i;
// These verbs express requested work only at the start of an instruction.
// Mentioning them inside a hypothetical or explanation does not start a task.
const DIRECT_WORK = /^(?:manage|adjust|configure|maintain|resolve|refactor|organize|customi[sz]e|apply)\s+\S/i;
const REQUESTED_EDITS = /^(?:make|apply|do)\s+(?:(?:the|some|requested|necessary)\s+)*(?:edits|fixes|changes|adjustments)\s+(?:to|in|on|for)\s+\S/i;

function isCapabilityQuestion(message) {
  const match = String(message || '').trim().replace(/[.!?]+$/g, '')
    .match(/^(?:can|could) you\s+([\s\S]+)$/i);
  if (!match) return false;
  // Generic capability lists have no concrete target or requested outcome.
  // Possessives, paths, names and extra instructions intentionally fail this
  // narrow vocabulary check: "Can you edit my files?" is a work request.
  return /^(?:(?:also|really|actually|do|manage|adjust|configure|maintain|resolve|refactor|organize|customi[sz]e|apply|edit|fix|repair|debug|create|write|build|make|update|upgrade|improve|change|run|execute|read|delete|restore|deploy|publish|test|check|research|things|stuff|anything|everything|files|code|websites|apps|applications|projects|documents|edits|fixes|changes|tasks|workspaces|settings|problems|errors|commands|tools|reports|data|and|or)[\s,]*)+$/i.test(match[1]);
}

function requestText(message) {
  return String(message || '').trim().replace(/[\u2018\u2019]/g, "'")
    .replace(/^please[\s,]+/i, '')
    .replace(/^(?:can|could|would|will) you(?: please)?\s+/i, '')
    .replace(/^(?:help me(?: to)?|i (?:want|need)(?: you)? to|i(?:'d| would) like(?: you)? to|what i (?:want|need) you to do is|how about you)\s+/i, '')
    .replace(/^do (?:whatever|what) is (?:necessary|needed|required) to\s+/i, '')
    .replace(/^please[\s,]+/i, '');
}

function noAction(message) {
  const text = String(message || '').trim();
  return /^(?:>|```|['"\u2018\u201c])/u.test(text)
    || /^(?:do not|don't|never|not to|i (?:do not|don't) want(?: you)? to)\b/i.test(requestText(text));
}

function isDirectRequest(message) {
  if (noAction(message)) return false;
  const text = requestText(message);
  return ACTION.test(text) || REQUESTED_EDITS.test(text) || isBuiltToolRequest(text)
    || /^(?:make sure|ensure)\s+\S+[\s\S]*\s+\S+/i.test(text);
}

function isBuiltToolRequest(message) {
  const text = String(message || '').trim();
  if (/^(?:please\s+)?(?:(?:can|could|would|will) you (?:please )?)?(?:use|call|invoke)\b[\s\S]{0,120}\b(?:functions?|extensions?)\b/i.test(text)) return true;
  if (!/^(?:please\s+)?(?:(?:can|could|would|will) you (?:please )?)?(?:read|list|search|inspect|find|open|show)\b/i.test(text)) return false;
  return /\b(?:repository|repo|source code|codebase|files?|folders?|directories|functions?|extensions?|queues?|services?|connections?|memories|memory|agents?|workers?|tasks?|terminals?|logs?|checks?|deployments?|backups?|controls?|activity)\b/i.test(text)
    || /\b(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+\b|\b[a-z0-9_-]+\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|css|html?|sql|toml|txt)\b/i.test(text);
}

export function isAgentQuestion(message) {
  const text = String(message || '').trim().replace(/[\u2018\u2019]/g, "'").toLowerCase().replace(/[.!?]+$/g, '');
  if (isCapabilityQuestion(text)) return true;
  if (/^(?:(?:hi|hello|hey)(?: there| pip)?|good morning|good afternoon|good evening|thanks(?: pip)?|thank you(?: pip)?|ok|okay|yes|no|go|start|run|help|help me|do something|do anything|do nothing|no task|anything|(?:start|run|do) (?:a |the )?task|cancel(?: task)?|stop(?: task)?|never mind|nevermind)$/.test(text)) return true;
  if (/^(?:please )?(?:explain|describe|tell me|help me understand|summarize|compare)\b/.test(text)) return true;
  if (/^(?:understand|learn|know|find out|explain|describe|discuss|summarize|compare)\b/.test(requestText(text))) return true;
  if (isDirectRequest(text)) return false;
  if (/^(?:what|why|when|where|who|which|how)\b/.test(text)) return true;
  if (isBuiltToolRequest(text)) return false;
  if (/^(?:can|could|would|will) you (?:please )?(?:fix|edit|update|upgrade|build|create|make|write|run|deploy|publish|change|improve|repair|remove|add|save|check|audit|refresh|investigate|test|debug|enable|disable|activate|deactivate|optimize|sync|transfer|drain|execute|pause|resume|restart|connect|disconnect|clear|delete|restore)\b/.test(text)) return false;
  return /^(?:can|could|would|will|do|does|is|are|have|has|should)\b/.test(text);
}

export function isExecutionRequest(message) {
  const text = String(message || '').trim().replace(/[\u2018\u2019]/g, "'");
  if (noAction(text)) return false;
  if (isAgentQuestion(text)) return false;
  const instruction = requestText(text);
  return isBuiltToolRequest(instruction)
    || DIRECT_WORK.test(instruction) || REQUESTED_EDITS.test(instruction)
    || /\b(?:fix|repair|debug|edit|update|upgrade|improve|build|run|deploy|publish|release|check|audit|refresh|investigate|implement|test|enable|disable|activate|deactivate|optimize|sync|transfer|drain|execute|pause|resume|restart|connect|disconnect|clear|delete|restore)\b/i.test(text)
    || (/\b(?:create|make|write|change|remove|add|save|set|increase|reduce)\b/i.test(instruction) && ACTION_OBJECT.test(instruction))
    || (/^(?:finish|complete)\s+\S/i.test(instruction) && ACTION_OBJECT.test(instruction))
    || /^(?:make sure|ensure)\s+\S+[\s\S]*\s+\S+/i.test(instruction)
    || (/^i (?:want|need|would like)\b/i.test(instruction) && ACTION_OBJECT.test(instruction))
    || /\b(?:broken|not working|doesn't work|does not work|keeps failing)\b/i.test(text)
    || (ACTION_OBJECT.test(text) && /\b(?:aren't|are not|isn't|is not) (?:running|executing|finishing|completing)(?: properly| correctly)?\b|\b(?:taking|takes) too long\b|\b(?:multiple|several|too many) attempts?\b|\b(?:needs?|need) (?:to be )?fixed\b/i.test(text));
}

export function needsToolSupport(message, files = []) {
  const text = String(message || '').trim();
  if (noAction(text) || isCapabilityQuestion(text)) return false;
  if (/^(?:hi|hello|hey|thanks|thank you|what can you do)[.!?]*$/i.test(text)) return false;
  if (files.some(file => /\.(?:csv|tsv)$/i.test(file.name || '') || file.type === 'text/csv')) return true;
  const instruction = requestText(text);
  // Longer deliverables need durable work, artifact receipts and automatic
  // continuation just as code does. A question about making one stays a chat.
  if (/^research\s+\S/i.test(instruction)) return true;
  if (/^(?:write|draft|prepare|create|make|build|produce|deliver)\s+\S/i.test(instruction)
    && /\b(?:reports?|briefings?|business plans?|proposals?|presentations?|slide decks?|spreadsheets?|workbooks?|documents?|research papers?|white papers?|launch plans?|marketing plans?|project plans?|courses?|curricul(?:um|a)|websites?|dashboards?)\b/i.test(instruction)) return true;
  return /\b(?:calculate|compute|solve|median|correlation|compound interest|standard deviation)\b/i.test(text)
    || /\d\s*[-+*/%^]\s*\d/.test(text)
    || /\b(?:analy[sz]e|explore)\b[\s\S]{0,100}\b(?:data|csv|json|table|spreadsheet|statistics)\b/i.test(text)
    || /\b(?:deep|thorough|in.depth|multi.source) research\b/i.test(text)
    || /\bresearch\b[\s\S]{0,100}\b(?:read|inspect)\b[\s\S]{0,40}\b(?:pages|sources)\b/i.test(text)
    || /\b(?:reusable|custom|saved) (?:functions?|extensions?)\b/i.test(text)
    || /\b(?:run|execute|test)\b[\s\S]{0,60}\b(?:functions?|extensions?)\b/i.test(text);
}
