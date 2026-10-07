import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import client from '../api/client';
import './TravelGuideDialog.css';

export default function TravelGuideDialog({ destination, onClose }) {
  const dialogRef = useRef(null), closeRef = useRef(null), topicRefs = useRef([]);
  const headingId = useId(), topicsId = useId();
  const [guide, setGuide] = useState(null), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  const [selectedTopic, setSelectedTopic] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.showModal(); closeRef.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setGuide(null); setLoading(true); setSelectedTopic(0);
    if (!destination.id) { setLoading(false); return undefined; }
    client.get('/travel/guides/' + encodeURIComponent(destination.id))
      .then(({data}) => { if (!cancelled && data?.id === destination.id) setGuide(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [destination.id, attempt]);
  const sections = Array.isArray(guide?.sections) ? guide.sections : [];
  const activeSection = sections[selectedTopic];
  function selectTopic(index, focus = false) {
    setSelectedTopic(index);
    const topic = topicRefs.current[index];
    if (focus) topic?.focus({ preventScroll: true });
    topic?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function handleTopicKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    selectTopic(next, true);
  }
  return createPortal(<dialog ref={dialogRef} className="travel-guide-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}><ArrowLeft size={17} />Back to Travel</button>
      <span><BookOpen size={16} />City guide</span>
    </header>
    <div className="travel-guide-body">
      <p className="travel-guide-country">{destination.country}</p>
      <h2 id={headingId}>{destination.city} city guide</h2>
      {loading ? <p role="status">Loading city guide…</p> : <>
        {guide?.overview && <p className="travel-guide-overview">{guide.overview}</p>}
        {!guide?.available && <div role="status"><p>The detailed guide is temporarily unavailable.</p><button type="button" className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>Retry city guide</button></div>}
        {guide?.stale && <p role="status">Showing the saved guide while the latest version is unavailable.</p>}
        {sections.length > 0 && <>
          <nav className="travel-guide-topics" role="tablist" aria-label="Guide topics" aria-orientation="horizontal">
            {sections.map((section, index) => <button key={index} ref={element => { topicRefs.current[index] = element; }}
              type="button" role="tab" id={`${topicsId}-topic-${index}`} aria-controls={`${topicsId}-panel`}
              aria-selected={index === selectedTopic} tabIndex={index === selectedTopic ? 0 : -1}
              onClick={() => selectTopic(index)} onKeyDown={event => handleTopicKey(event, index)}>{section.heading}</button>)}
          </nav>
          {activeSection && <section role="tabpanel" id={`${topicsId}-panel`}
            aria-labelledby={`${topicsId}-topic-${selectedTopic}`} tabIndex={0} data-guide-section={selectedTopic}>
            <h3>{activeSection.heading}</h3><p>{activeSection.text}</p>
          </section>}
          <footer>Text excerpts from Wikivoyage contributors, shortened and formatted for UFIConnect. Licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>. <a href={guide.sourceUrl} target="_blank" rel="noopener noreferrer">Original article</a> · <a href={guide.historyUrl} target="_blank" rel="noopener noreferrer">Contributors</a></footer>
        </>}
      </>}
    </div>
  </dialog>, document.body);
}
