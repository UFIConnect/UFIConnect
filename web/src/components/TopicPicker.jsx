import { useMemo, useState } from 'react';
import { Search, Check, X } from 'lucide-react';
import { searchRoleOptions } from '../utils/roleSearch.mjs';
import './TopicPicker.css';

const GROUPS = [
  ['technology', 'Technology', /ai|machine|software|dev|cyber|cloud|data|code|robot|blockchain|crypto|computer|internet|llm|quantum|ar \/ vr/i],
  ['work', 'Work & Business', /career|business|leadership|market|finance|fund|startup|sales|product|recruit|entrepreneur|freelanc|management|network|saas|econom|invest|agile/i],
  ['creative', 'Creative & Media', /design|art|music|film|video|photograph|creat|media|brand|story|writing|journal|anim|fashion|3d|game/i],
  ['science', 'Science & Health', /science|health|medic|bio|physics|chem|space|research|psych|environment|energy|veterinary/i],
  ['life', 'Life & Travel', /travel|food|fitness|sport|wellness|culture|nature|sustain|hospitality|culinar|lifestyle|mental/i],
  ['learning', 'Learning & Society', /educat|learn|teach|student|social|public|law|policy|civic|nonprofit|international|mentorship/i],
];
const groupFor = topic => GROUPS.find(([, , match])=>match.test(topic))?.[0] || 'other';
export default function TopicPicker({ topics, selected, suggested = [], onToggle }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('recommended');
  const [page, setPage] = useState(1);
  const pageSize = 36;
  const groups = [...GROUPS.map(([id,label])=>[id,label]), ['other','More topics']];
  const candidates = useMemo(()=>{
    if(query.trim()) return searchRoleOptions(topics, query);
    return topics.filter(topic => {
      if(category==='recommended') return suggested.includes(topic);
      if(category==='selected') return selected.includes(topic);
      return category==='all' || groupFor(topic)===category;
    });
  },[topics,query,category,selected,suggested]);
  const pageCount = Math.max(1, Math.ceil(candidates.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const shown = candidates.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <section className="topic-picker" aria-label="Choose topics">
    <div className="topic-picker-search"><Search size={18} aria-hidden="true" />
      <input type="search" aria-label="Search topics" placeholder="Search topics, interests, or industries" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} />
    </div>
    <div className="topic-picker-tabs" role="group" aria-label="Topic categories">
      {[['recommended','Recommended'],['selected',`Selected (${selected.length})`],['all','Browse all'],...groups].map(([id,label])=><button type="button" key={id} aria-pressed={category===id} onClick={()=>{setCategory(id);setQuery('');setPage(1);}}>{label}</button>)}
    </div>
    {selected.length>0 && <div className="topic-picker-selected" aria-label="Selected topics">{selected.map(topic=><button type="button" key={topic} aria-label={`Remove ${topic}`} onClick={()=>onToggle(topic)}>{topic}<X size={13} aria-hidden="true" /></button>)}</div>}
    <p className="topic-picker-status" role="status">{query ? `${candidates.length} matching topics` : category==='recommended' ? 'Suggestions for your role. Browse categories to explore more.' : `${candidates.length} topics`}</p>
    <div className="topic-picker-grid">{shown.map(topic=><button type="button" key={topic} aria-pressed={selected.includes(topic)} onClick={()=>onToggle(topic)}>
      <span className="topic-picker-check" aria-hidden="true">{selected.includes(topic) && <Check size={15} />}</span><span>{topic}</span>
    </button>)}</div>
    {!shown.length && <p className="topic-picker-empty">{query ? 'No matching topics. Try a shorter search.' : category==='selected' ? 'Select a topic to see it here.' : 'Browse another category to find topics.'}</p>}
    {pageCount>1 && <nav className="topic-picker-pagination" aria-label="Topic pages">
      <button type="button" className="btn btn-outline btn-sm" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button>
      <span role="status">Page {currentPage} of {pageCount}</span>
      <button type="button" className="btn btn-outline btn-sm" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>Next</button>
    </nav>}
  </section>;
}
