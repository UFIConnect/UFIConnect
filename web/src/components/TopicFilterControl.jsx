import { useEffect, useState } from 'react';

function TopicChoices({ options, selectedTopics, onToggle, search }) {
  const normalizedSearch = search.trim().toLowerCase();
  const visibleTopics = normalizedSearch
    ? options.filter((topic) => topic.toLowerCase().includes(normalizedSearch))
    : options;

  if (visibleTopics.length === 0) {
    return <div className="feed-topic-filter-empty">No matching topics</div>;
  }

  return (
    <div className="feed-topic-filter-options" role="group" aria-label="Topics">
      {visibleTopics.map((topic) => {
        const active = selectedTopics.includes(topic);
        return (
          <button
            key={topic}
            type="button"
            className={`feed-topic-filter-option${active ? ' active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(topic)}
          >
            {topic}
          </button>
        );
      })}
    </div>
  );
}

export default function TopicFilterControl({
  topics = [],
  options = [],
  onChange,
  open,
  onToggle,
  buttonRef,
  panelRef,
  ariaLabel = 'Filter feed by topic',
  panelId,
}) {
  const activeTopics = Array.isArray(topics) ? topics : [];
  const availableTopics = [...new Set(options.filter(Boolean))];
  const [draftTopics, setDraftTopics] = useState(activeTopics);
  const [topicSearch, setTopicSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftTopics(activeTopics);
    setTopicSearch('');
  }, [open, topics]);

  function toggleTopic(topic) {
    setDraftTopics((current) => current.includes(topic)
      ? current.filter((item) => item !== topic)
      : [...current, topic]);
  }

  function applyTopics() {
    onChange(draftTopics);
    onToggle(false);
  }

  return (
    <div className="feed-topic-filter">
      <button
        ref={buttonRef}
        type="button"
        className={`feed-toolbar-control feed-topic-filter-trigger${open || activeTopics.length ? ' active' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(!open)}
      >
        Topics{activeTopics.length ? ` (${activeTopics.length})` : ''}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} className="feed-topic-filter-popover">
          <div className="feed-topic-filter-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={draftTopics.length === 0}
              onClick={() => setDraftTopics([])}
            >
              Clear
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyTopics}>
              Apply topics
            </button>
          </div>
          <label className="feed-topic-filter-search">
            <input
              type="search"
              className="form-input"
              aria-label="Search topics"
              value={topicSearch}
              placeholder="Search topics"
              autoFocus
              onChange={(event) => setTopicSearch(event.target.value)}
            />
          </label>
          <div className="feed-topic-filter-count" aria-live="polite">
            {draftTopics.length ? `${draftTopics.length} selected` : 'All topics'}
          </div>
          <TopicChoices
            options={availableTopics}
            selectedTopics={draftTopics}
            onToggle={toggleTopic}
            search={topicSearch}
          />
        </div>
      )}
    </div>
  );
}
