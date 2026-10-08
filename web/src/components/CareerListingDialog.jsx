import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BriefcaseBusiness } from 'lucide-react';
import { safePostLink } from '../../../backend/post-links.mjs';
import { careerListingSections } from '../utils/careerListingSections.mjs';
import { SOURCE_META } from './sourceMeta';
import './TravelGuideDialog.css';

export default function CareerListingDialog({ post, fullText, onClose }) {
  const dialogRef = useRef(null), closeRef = useRef(null), topicRefs = useRef([]);
  const headingId = useId(), topicsId = useId();
  const sections = useMemo(() => careerListingSections(fullText), [fullText]);
  const [selectedTopic, setSelectedTopic] = useState(0);
  const activeSection = sections[selectedTopic];
  const sourceKey = String(post.source || '').toLowerCase().replace(/[^a-z]/g, '');
  const sourceLabel = SOURCE_META[sourceKey === 'themuse' ? 'muse' : sourceKey]?.label || post.source;
  const sourceUrl = safePostLink(post.sourceUrl);

  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.showModal(); closeRef.current?.focus(); document.body.style.overflow = 'hidden';
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

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

  return createPortal(<dialog ref={dialogRef} className="travel-guide-dialog career-listing-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}><ArrowLeft size={17} />Close listing</button>
      <span><BriefcaseBusiness size={16} />Job listing</span>
    </header>
    <div className="travel-guide-body">
      {(post.org || sourceLabel) && <p className="travel-guide-country">{[post.org, sourceLabel].filter(Boolean).join(' \u00b7 ')}</p>}
      <h2 id={headingId}>{post.title || 'Full supplied listing'}</h2>
      {sections.length > 0 && <>
        <nav className="travel-guide-topics" role="tablist" aria-label="Listing topics" aria-orientation="horizontal">
          {sections.map((section, index) => <button key={index} ref={element => { topicRefs.current[index] = element; }}
            type="button" role="tab" id={`${topicsId}-topic-${index}`} aria-controls={`${topicsId}-panel`}
            aria-selected={index === selectedTopic} tabIndex={index === selectedTopic ? 0 : -1}
            onClick={() => selectTopic(index)} onKeyDown={event => handleTopicKey(event, index)}>{section.heading}</button>)}
        </nav>
        {activeSection && <section role="tabpanel" id={`${topicsId}-panel`}
          aria-labelledby={`${topicsId}-topic-${selectedTopic}`} tabIndex={0}>
          <h3>{activeSection.heading}</h3><p>{activeSection.text}</p>
        </section>}
      </>}
      <footer>
        {sourceLabel ? `Listing supplied by ${sourceLabel}.` : 'Listing text supplied by the career site.'}
        {sourceUrl && <> <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open the original job listing</a></>}
      </footer>
    </div>
  </dialog>, document.body);
}
