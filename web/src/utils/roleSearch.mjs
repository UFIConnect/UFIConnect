const ALIASES = {
  swe: 'software engineer', sde: 'software developer', dev: 'developer',
  rn: 'registered nurse', pm: 'product manager', ux: 'user experience', ui: 'user interface',
  hr: 'human resources', qa: 'quality assurance', ai: 'artificial intelligence', ml: 'machine learning',
  js: 'javascript', ts: 'typescript', ceo: 'chief executive officer', cto: 'chief technology officer',
};
export function normalizeRoleSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/c\+\+/g, 'cplusplus').replace(/c#/g, 'csharp').replace(/\.net/g, 'dotnet')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function closeWord(a, b) {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i=0, j=0, edits=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) {i++;j++;continue;}
    if(++edits>1) return false;
    if(a.length>=b.length)i++;
    if(b.length>=a.length)j++;
  }
  return edits+(i<a.length || j<b.length ? 1 : 0)<=1;
}
export function searchRoleOptions(options, query) {
  const normalized = normalizeRoleSearch(query);
  if(!normalized) return options;
  const tokens = normalized.split(' ').flatMap(word => (ALIASES[word] || word).split(' '));
  return options.map((option, index) => {
    const name = normalizeRoleSearch(typeof option === 'string' ? option : option.value || option.title || option.label)
      .split(' ').flatMap(word => (ALIASES[word] || word).split(' ')).join(' ');
    const extra = normalizeRoleSearch(typeof option === 'string' ? '' : [option.desc, option.aliases, option.category].filter(Boolean).join(' '));
    const words = (name+' '+extra).split(' ');
    let score = name===normalized ? 100 : name.startsWith(normalized) ? 40 : 0;
    for(const token of tokens) {
      const direct = name.split(' ').some(word => word.startsWith(token));
      const extraMatch = extra.split(' ').some(word => word.startsWith(token));
      if(direct) score+=12;
      else if(extraMatch) score+=3;
      else if(words.some(word => closeWord(token,word))) score+=1;
      else return null;
    }
    return {option,index,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score || a.index-b.index).map(item=>item.option);
}
