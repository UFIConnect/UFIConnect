import { useId, useState } from 'react';

export default function TopicPicker({ taxonomy = [], value, onChange, label = 'Assign topic', disabled = false }) {
  const id = useId(), [visible,setVisible] = useState(12);
  const needle = value.trim().toLocaleLowerCase();
  const matches = taxonomy.filter(row => `${row.topic} ${(row.subtopics || []).join(' ')}`.toLocaleLowerCase().includes(needle));
  return <div className="utr-topic-picker">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="search" value={value} disabled={disabled} autoComplete="off" maxLength={200}
      placeholder="Find a topic or subtopic" onChange={event => { setVisible(12); onChange(event.target.value); }} />
    <div className="utr-topic-options" role="group" aria-label={`${label} choices`}>
      {matches.slice(0,visible).map(row => <button type="button" key={row.topic} disabled={disabled}
        aria-pressed={value === row.topic} onClick={() => { setVisible(12); onChange(row.topic); }}>{row.topic}</button>)}
    </div>
    {!matches.length && <small>No matching topics. Try a broader search.</small>}
    {matches.length > visible && <button type="button" className="utr-more-topics" disabled={disabled} onClick={() => setVisible(count => count + 24)}>Show more topics ({num(visible)} of {num(matches.length)})</button>}
  </div>;
}

function num(value) { return Number(value).toLocaleString(); }
