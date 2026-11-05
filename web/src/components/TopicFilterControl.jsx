import { useEffect, useState } from 'react';

const NO_SOURCES = [];

export function TopicChoices({ options = [], selectedTopics = [], onToggle, search = '' }) {
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
  sources = NO_SOURCES,
  sourceOptions = NO_SOURCES,
  onConnectSource,
}) {
  const activeTopics = Array.isArray(topics) ? topics : [];
  const availableTopics = [...new Set(options.filter(Boolean))];
  const [draftTopics, setDraftTopics] = useState(activeTopics);
  const [topicSearch, setTopicSearch] = useState('');
  const [draftSources, setDraftSources] = useState(sources);
  const [section, setSection] = useState('topics');
  const hasSources = sourceOptions.length > 0;
  const activeCount = activeTopics.length + (hasSources ? sources.length : 0);
  const sourceSearch = topicSearch.trim().toLowerCase();
  const visibleSources = sourceOptions.filter(source =>
    `${source.label} ${source.key}`.toLowerCase().includes(sourceSearch));

  useEffect(() => {
    if (!open) return;
    setDraftTopics(activeTopics);
    setDraftSources(sources);
    setTopicSearch('');
    setSection('topics');
  }, [open, topics, sources]);

  function toggleTopic(topic) {
    setDraftTopics((current) => current.includes(topic)
      ? current.filter((item) => item !== topic)
      : [...current, topic]);
  }

  function applyTopics() {
    onChange(draftTopics, hasSources ? draftSources : undefined);
    onToggle(false);
  }

  return (
    <div className="feed-topic-filter">
      <button
        ref={buttonRef}
        type="button"
        className={`feed-toolbar-control feed-topic-filter-trigger${open || activeCount ? ' active' : ''}`}
        aria-label={ariaLabel}
        aria-description={hasSources ? `Choose topics and sources for this feed. ${activeTopics.length} topics and ${sources.length} sources selected.` : undefined}
        title={hasSources ? `Topics & sources${activeCount ? ` (${activeCount} selected)` : ''}` : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(!open)}
      >
        {hasSources ? <>
          <span className="feed-topic-filter-label-full">Topics & sources{activeCount ? ` (${activeCount})` : ''}</span>
          <span className="feed-topic-filter-label-compact">Topics</span>
        </> : <>Topics{activeCount ? ` (${activeCount})` : ''}</>}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} className="feed-topic-filter-popover">
          <div className="feed-topic-filter-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={draftTopics.length === 0 && (!hasSources || draftSources.length === 0)}
              onClick={() => { setDraftTopics([]); setDraftSources([]); }}
            >
              Clear
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyTopics}>
              {hasSources ? 'Apply filters' : 'Apply topics'}
            </button>
          </div>
          {hasSources && <div className="feed-topic-filter-sections" role="group" aria-label="Filter categories">
            {[['topics', 'Topics', draftTopics.length], ['sources', 'Sources', draftSources.length]].map(([key, label, count]) => (
              <button key={key} type="button" aria-pressed={section === key}
                onClick={() => { setSection(key); setTopicSearch(''); }}>
                {label}{count ? ` (${count})` : ''}
              </button>
            ))}
          </div>}
          <label className="feed-topic-filter-search">
            <input
              type="search"
              className="form-input"
              aria-label={section === 'sources' && hasSources ? 'Search sources' : 'Search topics'}
              value={topicSearch}
              placeholder={section === 'sources' && hasSources ? 'Search sources' : 'Search topics'}
              autoFocus
              onChange={(event) => setTopicSearch(event.target.value)}
            />
          </label>
          <div className="feed-topic-filter-count" aria-live="polite">
            {section === 'sources' && hasSources
              ? draftSources.length ? `${draftSources.length} sources selected` : 'All sources'
              : draftTopics.length ? `${draftTopics.length} topics selected` : 'All topics'}
          </div>
          {section === 'sources' && hasSources ? (
            <div className="feed-topic-filter-options feed-topic-filter-sources" role="group" aria-label="Sources">
              {visibleSources.map(source => {
                const active = draftSources.includes(source.key);
                return <button key={source.key} type="button"
                  className={`feed-topic-filter-option${active ? ' active' : ''}`}
                  aria-pressed={active} disabled={source.locked && !active}
                  title={source.requiresConnection ? source.reason : undefined}
                  onClick={() => {
                    if (source.requiresConnection && !active) { onConnectSource?.(source.key); return; }
                    setDraftSources(current => current.includes(source.key)
                      ? current.filter(key => key !== source.key) : [...current, source.key]);
                  }}>
                  <span>{source.label}</span>
                  {source.requiresConnection && !active && <small>{source.locked ? 'Unavailable' : 'Connect'}</small>}
                </button>;
              })}
              {!visibleSources.length && <div className="feed-topic-filter-empty">No matching sources</div>}
            </div>
          ) : <TopicChoices
            options={availableTopics}
            selectedTopics={draftTopics}
            onToggle={toggleTopic}
            search={topicSearch}
          />}
        </div>
      )}
    </div>
  );
}
