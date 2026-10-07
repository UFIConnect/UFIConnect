import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import client from '../api/client';
import './TravelGuideDialog.css';

export default function TravelGuideDialog({ destination, onClose }) {
  const dialogRef = useRef(null), closeRef = useRef(null);
  const headingId = useId();
  const [guide, setGuide] = useState(null), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.showModal(); closeRef.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setGuide(null); setLoading(true);
    if (!destination.id) { setLoading(false); return undefined; }
    client.get('/travel/guides/' + encodeURIComponent(destination.id))
      .then(({data}) => { if (!cancelled && data?.id === destination.id) setGuide(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [destination.id, attempt]);
  const sections = Array.isArray(guide?.sections) ? guide.sections : [];
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
          <nav aria-label="Guide sections">{sections.map((section,index) => <button key={index} type="button" onClick={() => dialogRef.current?.querySelector(`[data-guide-section="${index}"]`)?.scrollIntoView({block:'start'})}>{section.heading}</button>)}</nav>
          {sections.map((section,index) => <section key={index} data-guide-section={index}><h3>{section.heading}</h3><p>{section.text}</p></section>)}
          <footer>Text excerpts from Wikivoyage contributors, shortened and formatted for UFIConnect. Licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>. <a href={guide.sourceUrl} target="_blank" rel="noopener noreferrer">Original article</a> · <a href={guide.historyUrl} target="_blank" rel="noopener noreferrer">Contributors</a></footer>
        </>}
      </>}
    </div>
  </dialog>, document.body);
}
