import { isCareerListing } from '../../../backend/job-sources.mjs';
import { careerHeadingKind as headingKind } from '../../../backend/job-sections.mjs';

export const isCareerPost = isCareerListing;
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
const decode = value => value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, key) => {
  if (key[0] !== '#') return entities[key.toLowerCase()] ?? match;
  const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
});
const clean = value => typeof value !== 'string' ? '' : decode(decode(value)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => headingKind(body.replace(/<[^>]+>/g, '')) ? `\n${body}\n` : body)
  .replace(/<li\b[^>]*>/gi, '\n- ')
  .replace(/<\/?(?:p|div|h[1-6]|br|ul|ol|section|article|table|tr)\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const short = (value, max = 340) => value.length <= max ? value : value.slice(0, max).replace(/\s+\S*$/, '') + '…';
const unique = values => {
  const seen = new Set();
  return values.map(value => value.replace(/\s+/g, ' ').trim()).filter(value => {
    const key = value.toLowerCase().replace(/[.!;:]+$/, '');
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  });
};
export function splitCareerSections(fullText) {
  const sections = [{ heading: '', kind: 'intro', lines: [] }];
  for (const raw of fullText.split('\n')) {
    const line = raw.trim();
    const inline = line.match(/^(.{3,85}?):\s+(.+)$/);
    const kind = headingKind(line) || (inline && headingKind(inline[1]));
    if (kind) sections.push({ heading: (inline ? inline[1] : line).replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/:$/, '').trim(), kind, lines: inline ? [inline[2]] : [] });
    else sections.at(-1).lines.push(raw);
  }
  return sections.map(section => ({ ...section, text: section.lines.join('\n').trim() })).filter(section => section.heading || section.text);
}
const verbs = new Set('administer analyse analyze answer arrange assess assist audit build care clean collaborate collect communicate conduct coordinate counsel create deliver design develop diagnose document drive educate enforce ensure evaluate examine execute facilitate help implement inspect install interview investigate lead maintain manage monitor negotiate operate organize oversee participate perform plan prepare present process produce protect provide purchase reconcile recruit repair report research resolve respond review schedule sell serve stock supervise support teach test train transport troubleshoot update verify work write'.split(' '));
function startsWithTask(value) {
  const body = value.replace(/^(?:in this role[, :]*)?\s*(?:(?:(?:the )?(?:successful )?(?:candidate|incumbent|employee|role|position)|you)\s+(?:(?:will|must|should)\s+(?:be expected to\s+|be responsible for\s+)?|(?:is|are) responsible for\s+|need to\s+)?|you['’]ll\s+|responsible for\s+)/i, '').trim();
  const word = body.toLowerCase().match(/^[a-z]+/)?.[0] || '';
  return [word, word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ing$/, ''), word.replace(/ing$/, 'e'), word.replace(/ed$/, ''), word.replace(/ed$/, 'e'), word.replace(/([a-z])\1ing$/, '$1')].some(form => verbs.has(form));
}
const notTask = /^(?:must (?:have|possess|hold)|you (?:must|should|need to) (?:have|possess|hold)|(?:minimum |preferred |required )?(?:experience|qualifications|skills|education)|(?:a |an |bachelor['’]?s |master['’]?s )?(?:degree|certification)|ability to|proficiency|knowledge of|we (?:offer|provide|are)|benefits|salary|compensation|competitive (?:pay|salary)|paid (?:leave|time off)|health insurance|work.life balance|valid (?:license|licence)|(?:at least )?\d+\+? years)\b/i;
const bullet = /^\s*(?:[-*•●▪◦‣]|\d+[.)])\s*/;
function items(text) {
  return text.split(/\n+|[•●▪‣]\s*|;\s+(?=\S)/).flatMap(line => line.replace(bullet, '').replace(/^\*\*|\*\*$/g, '').trim().split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map(value => value.trim()).filter(value => /[\p{L}\p{N}]/u.test(value) && value.length >= 4);
}
function suppliedText(value) {
  if (Array.isArray(value)) return value.map(suppliedText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') return suppliedText(value.text || value.description || value.content || value.value);
  return clean(value);
}
function fullDescription(post = {}) {
  const fields = ['fullDescription', 'full_description', 'jobDescription', 'job_description', 'description', 'content', 'contents', 'body'];
  const base = fields.map(key => suppliedText(post[key])).sort((a, b) => b.length - a.length)[0] || suppliedText(post.UserArea?.Details?.JobSummary);
  const tasks = unique(['responsibilities', 'duties', 'tasks', 'roleTasks', 'role_tasks'].map(key => suppliedText(post[key])).concat(suppliedText(post.UserArea?.Details?.MajorDuties)).filter(Boolean).flatMap(items));
  const requirements = unique(['requirements', 'qualifications', 'QualificationSummary'].map(key => suppliedText(post[key])).filter(Boolean).flatMap(items));
  const additions = [['Responsibilities', tasks], ['Requirements', requirements]].flatMap(([heading, values]) => {
    const missing = values.filter(value => !base.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ')));
    return missing.length ? [`${heading}\n${missing.map(value => `- ${value}`).join('\n')}`] : [];
  });
  return [base, ...additions].filter(Boolean).join('\n\n');
}
export function summarizeJob(post) {
  const fullText = fullDescription(post);
  const sections = splitCareerSections(fullText);
  const duties = [], qualifications = [], overview = [];
  for (const section of sections) {
    const values = items(section.text);
    if (section.kind === 'requirements') qualifications.push(...values);
    else if (['intro', 'role', 'tasks'].includes(section.kind)) {
      for (const value of values) {
        if (value.toLowerCase() === String(post?.title || '').trim().toLowerCase()) continue;
        if (section.kind !== 'tasks' && (!notTask.test(value) || /\b(?:seeking|looking for|hiring|this role|this position|join our)\b/i.test(value))) overview.push(value);
        if (notTask.test(value)) continue;
        if (section.kind === 'tasks' || startsWithTask(value)) duties.push(value);
      }
    }
  }
  const tasks = unique(duties);
  const requirements = unique(qualifications);
  const intro = short(overview.find(value => /\b(?:seeking|looking for|this role|this position|join our|you will|you['’]ll)\b/i.test(value)) || overview[0] || tasks[0] || '', 360);
  const details = (tasks.length ? tasks : unique(overview.filter(value => value !== intro))).slice(0, 5).map(value => short(value, 240));
  const summary = tasks.slice(0, 5).map(value => short(value.replace(/[.!;]+$/, ''), 95)).join('; ');
  return { fullText, intro, details, tasks, requirements, summary: summary ? `${summary}.` : '', hasTasks: tasks.length > 0 };
}
