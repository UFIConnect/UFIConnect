const CAREER_SOURCES = new Set(['indeed','remoteok','remotive','muse','themuse','usajobs','weworkremotely']);
export const isCareerPost = post => post?.type === 'job' || CAREER_SOURCES.has(String(post?.source || '').toLowerCase().replace(/[^a-z]/g,''));
const clean = value => String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<li\b[^>]*>/gi,'\n- ').replace(/<\/?(?:p|div|h[1-6]|br|ul|ol)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\r\n?/g,'\n').trim();
const short = (value,max=340) => value.length <= max ? value : value.slice(0,max).replace(/\s+\S*$/,'') + '…';
const dutiesHeading = /^(?:key |main |your |primary |essential )?(?:responsibilities|duties|role tasks|what you(?:'ll| will) do|what you do|the role|about (?:the|this) (?:role|position)|job description)\s*:?$/i;
const otherHeading = /^(?:(?:minimum |preferred |required |basic )?qualifications|requirements|what you(?:'ll| will) (?:bring|need)|about us|about (?:the|our) company|benefits|compensation|equal opportunity|how to apply|salary)\s*:?$/i;
const action = /^(?:(?:you(?:'ll| will)|the (?:candidate|role|position) will)\s+)?(?:design|build|develop|manage|lead|support|maintain|create|coordinate|analyze|analyse|deliver|collaborate|implement|conduct|prepare|provide|monitor|review|plan|work|write|test|ensure|assist|perform|oversee|drive|resolve|research|evaluate|operate|process)\b/i;
export function summarizeJob(post) {
  const fullText = [post?.fullDescription, post?.description, post?.content].map(clean).sort((a,b)=>b.length-a.length)[0] || '';
  const lines = fullText.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const duties = [], candidates = [];
  let inDuties = false;
  for (const line of lines) {
    const plain = line.replace(/^(?:[-*•]|\d+[.)])\s*/,'').trim();
    if (dutiesHeading.test(plain)) { inDuties=true; continue; }
    if (otherHeading.test(plain)) { inDuties=false; continue; }
    const sentences = plain.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s=>s.length>24);
    for (const sentence of sentences) {
      candidates.push(sentence);
      if ((inDuties || action.test(sentence)) && !/^(?:must have|experience with|we offer|benefits include)/i.test(sentence)) duties.push(sentence);
    }
  }
  const unique = values => [...new Set(values.map(s=>s.replace(/\s+/g,' ').trim()))];
  const tasks = unique(duties).slice(0,5).map(s=>short(s,240));
  const intro = short(candidates.find(s=>/\b(?:seeking|looking for|this role|this position|join our|you will)\b/i.test(s)) || candidates[0] || fullText,360);
  const details = tasks.length ? tasks : unique(candidates.filter(s=>s!==intro)).slice(0,3).map(s=>short(s,240));
  const summary = tasks.length ? tasks.slice(0,2).map(s=>short(s,150)).join(' ') : '';
  return {fullText,intro,details,summary,hasTasks:tasks.length>0};
}
