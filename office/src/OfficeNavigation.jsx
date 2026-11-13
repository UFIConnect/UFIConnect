import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRightLeft, BarChart3, Bot, Building2, ChevronDown, ChevronRight, Compass, Cpu, FileStack, FileText, Globe, History, KeyRound, LayoutGrid, Radio, Rocket, Rss, Search, Settings2, ShieldCheck, SlidersHorizontal, Tags, Users, Workflow, Wrench } from 'lucide-react';
import './office-navigation.css';

export const OFFICE_SECTIONS = [
  { id: 'overview', label: 'Overview', primary: true, group: 'Office', description: 'Platform health and recent activity' },
  { id: 'office-ai', label: 'Office AI', primary: true, group: 'Office', description: 'Office AI assistant, connections, memory and commands' },
  { id: 'focus-studio', label: 'Focus Studio', group: 'Office', description: 'Quiet Mode, work timer, soundscapes, and focus zones' },
  { id: 'api-keys', label: 'API Keys', primary: true, group: 'Office', description: 'Generate and manage UFIConnect API keys for your integrations' },
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

const SECTION_ICONS = {
  overview: Activity, 'office-ai': Bot, 'focus-studio': Compass, 'api-keys': KeyRound, city: Building2, 'local-web': Globe,
  sources: Radio, controls: SlidersHorizontal, setup: Settings2, deploy: Rocket,
  pipeline: Workflow, 'post-pipeline': FileStack, 'feed-audit': ShieldCheck,
  'topic-transfer': ArrowRightLeft, topics: Tags, feed: Rss, users: Users,
  analytics: BarChart3, reports: FileText, agents: Cpu, autofix: Wrench, versions: History,
};

export default function OfficeNavigation({ view, onNavigate, onPipScanSection, pipScan }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pipDragging, setPipDragging] = useState(false);
  const [dragTarget, setDragTarget] = useState(null);
  const navRef = useRef(null);
  const toggleRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    const onStart = () => setPipDragging(true);
    const onEnd = () => { setPipDragging(false); setDragTarget(null); };
    window.addEventListener('pip-scan-drag-start', onStart);
    window.addEventListener('pip-scan-drag-end', onEnd);
    return () => { window.removeEventListener('pip-scan-drag-start', onStart); window.removeEventListener('pip-scan-drag-end', onEnd); };
  }, []);
  function handleDragOver(event, sectionId) { event.preventDefault(); setDragTarget(sectionId); }
  function handleDragLeave(event, sectionId) { if (dragTarget === sectionId) setDragTarget(null); }
  function handleDropSection(event, section) {
    event.preventDefault();
    setDragTarget(null);
    const isPip = event.dataTransfer.getData('text/pip-scan') === 'pip';
    if (!isPip) return;
    onPipScanSection?.(section.id, section.label);
  }
  const current = OFFICE_SECTIONS.find(section => section.id === view);
  const search = query.trim().toLowerCase();
  const tools = OFFICE_SECTIONS.filter(section => search
    ? `${section.label} ${section.description} ${section.group}`.toLowerCase().includes(search)
    : !section.primary);
  const groups = [...new Set(tools.map(section => section.group))];

  useEffect(() => {
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
    setOpen(false);
    // Keep focus on the visible navigation when the directory closes.
    const primary = navRef.current?.querySelector(`.office-nav-primary [data-office-view="${id}"]`);
    (primary || toggleRef.current)?.focus({ preventScroll: true });
  };

  return <nav ref={navRef} className="office-navigation" aria-label="Office sections">
    <div className="office-nav-primary">
      {OFFICE_SECTIONS.filter(section => section.primary).map(section => <button type="button" key={section.id}
        data-office-view={section.id} aria-current={view === section.id ? 'page' : undefined} onClick={() => navigate(section.id)} title={section.description}
        data-pip-drop-active={pipDragging || undefined}
        data-pip-drop-over={dragTarget === section.id || undefined}
        data-pip-scanned={pipScan?.section === section.id || undefined}
        onDragOver={event => handleDragOver(event, section.id)}
        onDragLeave={event => handleDragLeave(event, section.id)}
        onDrop={event => handleDropSection(event, section)}>
        {section.label}
      </button>)}
    </div>
    <button ref={toggleRef} type="button" className="office-nav-toggle" aria-expanded={open} aria-controls="office-more-tools"
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        }
      }}>
      <LayoutGrid size={16} aria-hidden="true" /><span>More tools</span>
      {!open && !current?.primary && <span className="office-nav-current">{current?.label}</span>}
      <ChevronDown className="office-nav-chevron" size={16} aria-hidden="true" />
    </button>
    <div id="office-more-tools" className="office-nav-more" hidden={!open} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    }}>
      <div className="office-nav-directory-header">
        <div><h2>Tools and workflows</h2><p>Find the right place to manage your Office.</p></div>
        <div className="office-nav-search"><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Find an Office tool" placeholder="Find a tool or workflow…"
          value={query} onChange={event => setQuery(event.target.value)} /></div>
      </div>
      <div className="office-nav-groups">
        {groups.map(group => <section key={group} aria-label={group}>
          <h3>{group}</h3>
          {tools.filter(section => section.group === group).map(section => {
            const Icon = SECTION_ICONS[section.id];
            return <button type="button" key={section.id}
              aria-label={section.label} aria-current={view === section.id ? 'page' : undefined} onClick={() => navigate(section.id)}
              data-pip-drop-active={pipDragging || undefined}
              data-pip-drop-over={dragTarget === section.id || undefined}
              data-pip-scanned={pipScan?.section === section.id || undefined}
              onDragOver={event => handleDragOver(event, section.id)}
              onDragLeave={event => handleDragLeave(event, section.id)}
              onDrop={event => handleDropSection(event, section)}>
              <span className="office-nav-tool-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="office-nav-tool-copy"><span>{section.label}</span><small>{section.description}</small></span>
              <ChevronRight className="office-nav-tool-arrow" size={15} aria-hidden="true" />
            </button>;
          })}
        </section>)}
        {!tools.length && <p role="status">No tools match “{query}”. Try sources, posts, users, or setup.</p>}
      </div>
    </div>
  </nav>;
}
