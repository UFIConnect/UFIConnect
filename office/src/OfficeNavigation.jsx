import { useEffect, useRef, useState } from 'react';
import './office-navigation.css';

export const OFFICE_SECTIONS = [
  { id: 'overview', label: 'Overview', primary: true, group: 'Office', description: 'Platform health and recent activity' },
  { id: 'office-ai', label: 'Office AI', primary: true, group: 'Office', description: 'Assistant, connections, memory and commands' },
  { id: 'city', label: 'Live City', primary: true, group: 'Office', description: 'Explore services and agents on the map' },
  { id: 'local-web', label: 'Local web', primary: true, group: 'Office', description: 'Preview and edit the front website' },
  { id: 'sources', label: 'Live Sources', primary: true, group: 'Content flow', description: 'Integrated source health and collection rates' },
  { id: 'controls', label: 'Controls', primary: true, group: 'Operations', description: 'Review and run platform commands' },
  { id: 'setup', label: 'Setup', primary: true, group: 'Operations', description: 'Service configuration and provider readiness' },
  { id: 'deploy', label: 'Deploy Center', primary: true, group: 'Operations', description: 'Deployment status and service releases' },
  { id: 'pipeline', label: 'Pipeline', group: 'Content flow', description: 'Follow collection, staging and delivery' },
  { id: 'post-pipeline', label: 'Post Pipeline', group: 'Content flow', description: 'Inspect post history and processing stages' },
  { id: 'feed-audit', label: 'Feed Audit', group: 'Content flow', description: 'Moderation, source limits and flood protection' },
  { id: 'topic-transfer', label: 'Topic Transfer', group: 'Content flow', description: 'Move staged posts into topics' },
  { id: 'topics', label: 'Topics', group: 'Content flow', description: 'Browse topic coverage and source distribution' },
  { id: 'feed', label: 'Feed Manager', group: 'Content flow', description: 'Delivery, sorting and refetch queues' },
  { id: 'users', label: 'Users', group: 'People and insights', description: 'Member accounts and individual usage' },
  { id: 'analytics', label: 'Analytics', group: 'People and insights', description: 'Traffic, activity and source performance' },
  { id: 'reports', label: 'Reports', group: 'People and insights', description: 'Platform reports and summaries' },
  { id: 'agents', label: 'Agents', group: 'Operations', description: 'Worker health, logs and agent actions' },
  { id: 'autofix', label: 'Autofix', group: 'Operations', description: 'Automatic recovery and repairs' },
  { id: 'versions', label: 'Versions', group: 'Operations', description: 'Compare API and pipeline releases' },
];

export default function OfficeNavigation({ view, onNavigate }) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches && !OFFICE_SECTIONS.find(section => section.id === view)?.primary);
  const [query, setQuery] = useState('');
  const navRef = useRef(null);
  const toggleRef = useRef(null);
  const current = OFFICE_SECTIONS.find(section => section.id === view);
  const search = query.trim().toLowerCase();
  const tools = OFFICE_SECTIONS.filter(section => search
    ? `${section.label} ${section.description} ${section.group}`.toLowerCase().includes(search)
    : !section.primary);
  const groups = [...new Set(tools.map(section => section.group))];

  useEffect(() => {
    if (window.matchMedia('(min-width: 761px)').matches && !OFFICE_SECTIONS.find(section => section.id === view)?.primary) setOpen(true);
    const active = navRef.current?.querySelector('.office-nav-primary [aria-current="page"]');
    if (active) {
      const row = active.parentElement;
      const bounds = active.getBoundingClientRect(), rowBounds = row.getBoundingClientRect();
      if (bounds.left < rowBounds.left) row.scrollLeft -= rowBounds.left - bounds.left;
      if (bounds.right > rowBounds.right) row.scrollLeft += bounds.right - rowBounds.right;
    }
  }, [view]);

  const navigate = id => {
    if (onNavigate(id) === false) return;
    setQuery('');
    if (window.matchMedia('(max-width: 760px)').matches) setOpen(false);
    // A filtered primary result disappears when search clears; retain keyboard focus.
    const primary = navRef.current?.querySelector(`.office-nav-primary [data-office-view="${id}"]`);
    (primary || (window.matchMedia('(max-width: 760px)').matches ? toggleRef.current : null))?.focus({ preventScroll: true });
  };

  return <nav ref={navRef} className="office-navigation" aria-label="Office sections">
    <div className="office-nav-primary">
      {OFFICE_SECTIONS.filter(section => section.primary).map(section => <button type="button" key={section.id}
        data-office-view={section.id} aria-current={view === section.id ? 'page' : undefined} onClick={() => navigate(section.id)} title={section.description}>
        {section.label}
      </button>)}
    </div>
    <button ref={toggleRef} type="button" className="office-nav-toggle" aria-expanded={open} aria-controls="office-more-tools"
      onClick={() => setOpen(value => !value)}>
      More tools{!open && !current?.primary && <span className="office-nav-current"> · {current?.label}</span>}
      <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
    </button>
    <div id="office-more-tools" className="office-nav-more" hidden={!open} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    }}>
      <input type="search" aria-label="Find an Office tool" placeholder="Find a tool, source, or workflow…"
        value={query} onChange={event => setQuery(event.target.value)} />
      <div className="office-nav-groups">
        {groups.map(group => <section key={group} aria-label={group}>
          <h2>{group}</h2>
          {tools.filter(section => section.group === group).map(section => <button type="button" key={section.id}
            aria-label={section.label} aria-current={view === section.id ? 'page' : undefined} onClick={() => navigate(section.id)}>
            <span>{section.label}</span><small>{section.description}</small>
          </button>)}
        </section>)}
        {!tools.length && <p role="status">No tools match “{query}”. Try sources, posts, users, or setup.</p>}
      </div>
    </div>
  </nav>;
}
