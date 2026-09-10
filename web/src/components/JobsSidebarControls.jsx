import { useLocation, useNavigate } from 'react-router-dom';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';

export const JOB_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'match', label: 'Best match' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'live', label: 'Live first' },
  { value: 'remote', label: 'Remote first' },
  { value: 'employer', label: 'Employer A-Z' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'source', label: 'Career site A-Z' },
];

export const JOB_CAREER_SITES = [
  { key: 'indeed', label: 'Indeed' },
  { key: 'remoteok', label: 'Remote OK' },
  { key: 'remotive', label: 'Remotive' },
  { key: 'muse', label: 'The Muse' },
  { key: 'usajobs', label: 'USAJobs' },
];

function JobControlIcon({ name }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };
  const paths = {
    all: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M8 5V3h8v2" /><path d="M3 11h18" /></>,
    remote: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /></>,
    other: <><path d="M4 7h16v13H4z" /><path d="M8 7V4h8v3" /><path d="M4 12h16" /></>,
    live: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4" /></>,
  };
  return <svg {...common}>{paths[name] || paths.all}</svg>;
}

function SourceIcon({ source }) {
  if (hasBrandIcon(source.key)) return <BrandIcon platform={source.key} size={15} />;
  return <span className="jobs-sidebar-source-fallback">{SOURCE_META[source.key]?.icon || source.label.slice(0, 2)}</span>;
}

export default function JobsSidebarControls({ onNavigate }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const workSetting = ['remote', 'other'].includes(params.get('work')) ? params.get('work') : 'all';
  const liveOnly = params.get('live') === '1';
  const selectedSource = params.get('sources') || '';
  const requestedSort = params.get('sort') || 'newest';
  const sort = JOB_SORT_OPTIONS.some((option) => option.value === requestedSort) ? requestedSort : 'newest';

  function updateFilters(changes) {
    const next = new URLSearchParams(location.pathname.startsWith('/opportunities') ? location.search : '');
    Object.entries(changes).forEach(([key, value]) => {
      if (value == null || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    const query = next.toString();
    navigate(`/opportunities${query ? `?${query}` : ''}`, { replace: location.pathname === '/opportunities' });
    onNavigate?.();
  }

  function selectJobView(view) {
    if (view === 'remote' || view === 'other') {
      updateFilters({ work: view, live: null });
      return;
    }
    if (view === 'live') {
      updateFilters({ work: null, live: '1' });
      return;
    }
    updateFilters({ work: null, live: null });
  }

  return (
    <div className="jobs-sidebar-controls">
      <section className="jobs-sidebar-section" aria-labelledby="jobs-sidebar-view-heading">
        <h2 id="jobs-sidebar-view-heading">Jobs</h2>
        <div className="jobs-sidebar-options" role="radiogroup" aria-label="Job listings">
          <button type="button" className={`jobs-sidebar-option${workSetting === 'all' && !liveOnly ? ' active' : ''}`} role="radio" aria-checked={workSetting === 'all' && !liveOnly} onClick={() => selectJobView('all')}>
            <JobControlIcon name="all" />
            <span>All listings</span>
          </button>
          <button type="button" className={`jobs-sidebar-option${workSetting === 'remote' && !liveOnly ? ' active' : ''}`} role="radio" aria-checked={workSetting === 'remote' && !liveOnly} onClick={() => selectJobView('remote')}>
            <JobControlIcon name="remote" />
            <span>Remote</span>
          </button>
          <button type="button" className={`jobs-sidebar-option${workSetting === 'other' && !liveOnly ? ' active' : ''}`} role="radio" aria-checked={workSetting === 'other' && !liveOnly} onClick={() => selectJobView('other')}>
            <JobControlIcon name="other" />
            <span>Other listings</span>
          </button>
          <button type="button" className={`jobs-sidebar-option${liveOnly ? ' active' : ''}`} role="radio" aria-checked={liveOnly} onClick={() => selectJobView('live')}>
            <JobControlIcon name="live" />
            <span>Live listings</span>
          </button>
        </div>
      </section>

      <section className="jobs-sidebar-section" aria-labelledby="jobs-sidebar-date-heading">
        <h2 id="jobs-sidebar-date-heading">Date posted</h2>
        <div className="jobs-sidebar-options" role="radiogroup" aria-label="Date posted">
          {[['', 'Any time'], ['1', 'Today'], ['7', 'Past week'], ['30', 'Past month']].map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={(params.get('postedWithin') || '') === value}
              className={`jobs-sidebar-option${(params.get('postedWithin') || '') === value ? ' active' : ''}`}
              onClick={() => updateFilters({ postedWithin: value || null })}>{label}</button>
          ))}
        </div>
      </section>

      <section className="jobs-sidebar-section" aria-labelledby="jobs-sidebar-sites-heading">
        <h2 id="jobs-sidebar-sites-heading">Career sites</h2>
        <div className="jobs-sidebar-options" role="radiogroup" aria-label="Career sites">
          <button type="button" className={`jobs-sidebar-option${!selectedSource ? ' active' : ''}`} role="radio" aria-checked={!selectedSource} onClick={() => updateFilters({ sources: null })}>
            <span className="jobs-sidebar-source-all" aria-hidden="true">All</span>
            <span>All career sites</span>
          </button>
          {JOB_CAREER_SITES.map((source) => (
            <button
              key={source.key}
              type="button"
              className={`jobs-sidebar-option${selectedSource === source.label ? ' active' : ''}`}
              role="radio"
              aria-checked={selectedSource === source.label}
              onClick={() => updateFilters({ sources: source.label })}
            >
              <span className="jobs-sidebar-source-icon"><SourceIcon source={source} /></span>
              <span>{source.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="jobs-sidebar-section" aria-labelledby="jobs-sidebar-sort-heading">
        <h2 id="jobs-sidebar-sort-heading">Sort options</h2>
        <div className="jobs-sidebar-options jobs-sidebar-options--sort" role="radiogroup" aria-label="Sort jobs">
          {JOB_SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`jobs-sidebar-option${sort === option.value ? ' active' : ''}`}
              role="radio"
              aria-checked={sort === option.value}
              onClick={() => updateFilters({ sort: option.value === 'newest' ? null : option.value })}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
