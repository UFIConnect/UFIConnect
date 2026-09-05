import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import TopicFilterControl from '../components/TopicFilterControl';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

const CATEGORY_META = {
  'AI & ML':     { icon: 'AI', bg: '#F3EEFF', text: '#7C3AED' },
  'Engineering': { icon: 'EN', bg: '#EFF6FF', text: '#2563EB' },
  'Startups':    { icon: 'ST', bg: '#FFFBEB', text: '#D97706' },
  'Design':      { icon: 'DS', bg: '#FDF2F8', text: '#DB2777' },
  'Marketing':   { icon: 'MK', bg: '#ECFDF5', text: '#059669' },
  'Finance':     { icon: 'FI', bg: '#F0F9FF', text: '#0284C7' },
  'Remote Work': { icon: 'RW', bg: '#EEF2FF', text: '#4338CA' },
  'Education':   { icon: 'ED', bg: '#FFF7ED', text: '#EA580C' },
  'Social':      { icon: 'SO', bg: '#F9FAFB', text: '#6B7280' },
  'Health':      { icon: 'HE', bg: '#F0FDF4', text: '#16A34A' },
  'Climate':     { icon: 'CL', bg: '#ECFDF5', text: '#065F46' },
  'Food':        { icon: 'FD', bg: '#FFF7ED', text: '#C2410C' },
  'Travel':      { icon: 'TR', bg: '#F0F9FF', text: '#0369A1' },
  'Gaming':      { icon: 'GM', bg: '#F5F3FF', text: '#6D28D9' },
  'Music':       { icon: 'MU', bg: '#FDF4FF', text: '#A21CAF' },
  'Fashion':     { icon: 'FA', bg: '#FFF1F2', text: '#BE123C' },
  'Lifestyle':   { icon: 'LI', bg: '#FFFFF0', text: '#92400E' },
  'Sports':      { icon: 'SP', bg: '#ECFDF5', text: '#047857' },
  'Space':       { icon: 'SC', bg: '#EEF2FF', text: '#3730A3' },
};

const PLATFORM_META = {
  reddit:      { icon: 'RD', label: 'Reddit',         color: '#FF4500' },
  discord:     { icon: 'DS', label: 'Discord',        color: '#5865F2' },
  linkedin:    { icon: 'in', label: 'LinkedIn',       color: '#0A66C2' },
  hackernews:  { icon: 'HN', label: 'News',           color: '#FF6600' },
  devto:       { icon: 'DEV', label: 'DEV Community', color: '#3B49DF' },
  github:      { icon: 'GH', label: 'GitHub',         color: '#24292F' },
  uficonnect:  { icon: 'UFI', label: 'UFIconnect',    color: '#102A6B' },
};

function GroupSkeleton() {
  return (
    <div className="card group-card" style={{ marginBottom: 12, opacity: 0.6 }}>
      <div style={{ height: 16, borderRadius: 4, background: 'var(--border)', marginBottom: 12, width: '40%', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', marginBottom: 8, animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', marginBottom: 12, width: '70%', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ height: 10, borderRadius: 4, background: 'var(--border)', width: '30%', animation: 'pulse 2s ease-in-out infinite' }} />
        <div style={{ height: 24, borderRadius: 4, background: 'var(--border)', width: '20%', animation: 'pulse 2s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

export function CreateGroupModal({ categories, onClose, onCreate }) {
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState(categories[0] || '');
  const [isPrivate,   setIsPrivate]   = useState(false);
  const [error,       setError]       = useState('');
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    if (!category && categories[0]) setCategory(categories[0]);
  }, [categories, category]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Give your group a name.'); return; }
    if (!category.trim()) { setError('Pick a category.'); return; }
    setSaving(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), description: description.trim(), category, isPrivate });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create the group. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 80, overflowY: 'auto',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="card"
        style={{ width: 'min(480px, 92vw)', boxShadow: '0 16px 48px rgba(0,0,0,.18)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>Create a group</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Group name</label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Frontend Engineers of NYC"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this group about?"
            rows={3}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          {categories.length > 0 ? (
            <select
              className="form-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input
              className="form-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Engineering"
            />
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Visibility</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: false, label: 'Public', desc: 'Listed for everyone, anyone can join' },
              { value: true,  label: 'Private', desc: 'Hidden from the directory - join by invite only' },
            ].map(({ value, label, desc }) => {
              const active = isPrivate === value;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setIsPrivate(value)}
                  style={{
                    flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                    border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    background: active ? 'var(--primary-light)' : 'var(--surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '.85rem', color: active ? 'var(--primary)' : 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : 'Create group'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function Groups() {
  return (
    <>
      <Helmet>
        <title>Professional Communities & Groups | Connect with Your People on UFIconnect</title>
        <meta name="description" content="Discover and connect with 50+ professional communities. Find Reddit communities, Discord servers, LinkedIn groups, Facebook Groups, Twitter communities, Hacker News, GitHub, and DEV.to — all curated by role and interests. Network with engineers, designers, founders, and creatives." />
        <meta name="keywords" content="professional communities, tech communities, developer groups, connect communities, networking groups, Discord communities, Reddit communities, LinkedIn groups, Facebook Groups, tech groups, engineering communities, design communities, startup communities, news communities, group networking, professional groups, career groups" />
        <link rel="canonical" href="https://uficonnect.org/groups" />
      </Helmet>
      <GroupsContent />
    </>
  );
}

export function GroupsContent({ embedded = false, scope = 'all' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const topicButtonRef = useRef(null);
  const topicPanelRef = useRef(null);
  const [groups,      setGroups]      = useState([]);
  const [categories,  setCategories]  = useState([]);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [topicFilterOpen, setTopicFilterOpen] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showCreate,  setShowCreate]  = useState(() => new URLSearchParams(location.search).get('create') === '1');

  function loadGroups(bust = false, silent = false) {
    if (bust) setRefreshing(true);
    else if (!silent) setLoading(true);
    setError(false);

    Promise.all([
      client.get('/groups', { params: { ...(bust ? { bust: 1 } : {}), ...(scope === 'public' ? { scope: 'public' } : {}) } }),
      client.get('/groups/categories'),
    ])
      .then(([gRes, cRes]) => {
        setGroups(gRes.data.groups || []);
        setCategories(cRes.data.categories || []);
      })
      .catch(err => {
        console.error('Failed to load groups:', err);
        setError(true);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    loadGroups();
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => loadGroups(false, true);
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (new URLSearchParams(location.search).get('create') === '1') setShowCreate(true);
  }, [location.search]);

  useEffect(() => {
    if (!topicFilterOpen) return undefined;

    function closeTopics(event) {
      if (topicButtonRef.current?.contains(event.target) || topicPanelRef.current?.contains(event.target)) return;
      setTopicFilterOpen(false);
    }

    function closeTopicsOnEscape(event) {
      if (event.key === 'Escape') setTopicFilterOpen(false);
    }

    document.addEventListener('pointerdown', closeTopics);
    document.addEventListener('keydown', closeTopicsOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeTopics);
      document.removeEventListener('keydown', closeTopicsOnEscape);
    };
  }, [topicFilterOpen]);

  // Scrolling back up to the top refreshes this live directory.
  useScrollToRefresh(() => loadGroups(true), { enabled: !loading && !refreshing });

  async function handleCreateGroup({ name, description, category, isPrivate }) {
    const { data } = await client.post('/groups', { name, description, category, isPrivate });
    setGroups((prev) => [data.group, ...prev]);
    setShowCreate(false);
    navigate(`/groups/${data.group.id}`);
  }

  const ContentShell = embedded ? 'section' : Layout;
  const groupTopics = [...new Set([
    ...categories,
    ...groups.map((group) => group.category),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibleGroups = selectedTopics.length === 0
    ? groups
    : groups.filter((group) => {
      const searchable = `${group.category || ''} ${group.name || ''} ${group.description || ''}`.toLowerCase();
      return selectedTopics.some((topic) => {
        const normalizedTopic = topic.toLowerCase();
        if (searchable.includes(normalizedTopic)) return true;
        return normalizedTopic
          .split(/[^a-z0-9]+/)
          .filter((term) => term.length > 2)
          .some((term) => searchable.includes(term));
      });
    });

  return (
    <ContentShell className={embedded ? 'home-embedded-feed' : undefined}>
      <div className="page-header groups-page-header">
        <div className="groups-page-heading">
          <h1 className="page-title">Discover Groups</h1>
        </div>
        <div className="groups-page-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action group-create-button"
            onClick={() => {
              setTopicFilterOpen(false);
              setShowCreate(true);
            }}
          >
            Create a group
          </button>
          <TopicFilterControl
            topics={selectedTopics}
            options={groupTopics}
            onChange={setSelectedTopics}
            open={topicFilterOpen}
            onToggle={setTopicFilterOpen}
            buttonRef={topicButtonRef}
            panelRef={topicPanelRef}
            ariaLabel="Filter discover groups by topic"
            panelId="discover-groups-topic-filter"
          />
        </div>
      </div>

      {showCreate && (
        <CreateGroupModal
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            marginBottom: 16,
            background: '#FEE2E2',
            color: '#991B1B',
            fontSize: '.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>!</span>
          <span>
            Failed to load groups.{' '}
            <button
              onClick={() => loadGroups()}
              style={{
                background: 'none',
                border: 'none',
                color: '#991B1B',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div>
          <div
            style={{
              marginBottom: 12,
              color: 'var(--muted)',
              fontSize: '.85rem',
              fontWeight: 600,
            }}
          >
            Loading groups…
          </div>
          <GroupSkeleton />
          <GroupSkeleton />
          <GroupSkeleton />
        </div>
      )}

      {/* Content */}
      {!loading && !error && groups.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">Q</div>
          <div className="empty-title">No live groups yet</div>
          <div className="empty-desc">Create the first group or check back shortly.</div>
        </div>
      )}

      {!loading && !error && groups.length > 0 && visibleGroups.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">Topics</div>
          <div className="empty-title">No groups match these topics</div>
          <div className="empty-desc">Clear the topic selection to see every live group.</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setSelectedTopics([])}>
            Show all groups
          </button>
        </div>
      )}

      {/* Live group directory. The topic control narrows this same live list. */}
      {!loading && !error && visibleGroups.length > 0 && (
        <div>
          <p
            style={{
              fontSize: '.8rem',
              color: 'var(--muted)',
              marginBottom: 16,
              fontWeight: 500,
            }}
          >
            {selectedTopics.length > 0 ? `${visibleGroups.length} of ${groups.length}` : visibleGroups.length} live public {visibleGroups.length !== 1 ? 'communities' : 'community'}
          </p>
          <div className="group-directory-list group-live-list">
              <div className="group-directory-list-heading">
                <strong>Live groups</strong>
                <span>{visibleGroups.length.toLocaleString()}</span>
              </div>
              <div className="group-directory-tabs" role="group" aria-label="Live groups">
                {visibleGroups.map((group, index) => (
                  <GroupDirectoryTab
                    key={group.id}
                    group={group}
                    index={index}
                    onSelect={() => navigate(`/groups/${group.id}`)}
                  />
                ))}
              </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </ContentShell>
  );
}

function groupOrigin(group) {
  const platform = group.platform
    ? PLATFORM_META[group.platform]
    : group.subreddit
      ? PLATFORM_META.reddit
      : null;
  return group.isExternal
    ? platform || { icon: 'WEB', label: 'Community', color: '#64748B' }
    : PLATFORM_META.uficonnect;
}

export function GroupDirectoryTab({ group, index, onSelect }) {
  const meta = CATEGORY_META[group.category] || { icon: 'GR' };
  const origin = groupOrigin(group);
  return (
    <button
      id={`group-directory-tab-${index}`}
      type="button"
      className={`group-directory-tab${group.isJoined ? ' joined' : ''}`}
      onClick={onSelect}
      aria-label={`Open ${group.name}`}
    >
      <span className="group-directory-tab-mark" aria-hidden="true">{meta.icon}</span>
      <span className="group-directory-tab-copy">
        <strong>{group.name}</strong>
        <span>{group.category || 'Community'}</span>
        <span className="group-directory-tab-description">{group.description || 'Open for group details and recent posts.'}</span>
        <small>
          {group.members?.toLocaleString() || 0} members - {origin.label} - {group.isJoined ? 'Joined' : 'Not joined'}
        </small>
      </span>
    </button>
  );
}

export function GroupInformation({ group, index = 0, isJoined, joining, onJoin, onOpen, standalone = false }) {
  if (!group) return null;
  const meta = CATEGORY_META[group.category] || {
    icon: 'GR',
    bg: '#F1F5F9',
    text: '#64748B',
  };
  const origin = groupOrigin(group);
  const externalUrl = group.externalUrl || group.platformUrl;

  return (
    <section
      id="selected-group-information"
      role={standalone ? undefined : 'tabpanel'}
      aria-labelledby={standalone ? undefined : `group-directory-tab-${index}`}
      className="card group-information-panel"
    >
      <div className="group-information-heading">
        <span className="group-information-mark" style={{ background: meta.bg, color: meta.text }} aria-hidden="true">
          {meta.icon}
        </span>
        <div>
          <h2>{group.name}</h2>
          <span className="group-information-origin" style={{ color: origin.color }}>
            {origin.icon} {origin.label}
          </span>
        </div>
      </div>

      <div className="group-information-badges">
        <span style={{ background: meta.bg, color: meta.text }}>{group.category || 'Community'}</span>
        <span>{group.isPrivate ? 'Private group' : 'Public group'}</span>
        <span>{isJoined ? 'Joined' : 'Not joined'}</span>
      </div>

      <dl className="group-information-facts">
        <div><dt>Members</dt><dd>{group.members?.toLocaleString() || 0}</dd></div>
        <div><dt>Source</dt><dd>{origin.label}</dd></div>
        <div><dt>Category</dt><dd>{group.category || 'Community'}</dd></div>
        <div><dt>Access</dt><dd>{group.isPrivate ? 'Private' : 'Public'}</dd></div>
      </dl>

      <div className="group-information-about">
        <h3>About</h3>
        <p>
          {group.name} is a {group.isPrivate ? 'private' : 'public'} {group.category || 'community'} group
          {origin.label ? ` on ${origin.label}` : ''} with {(group.members || 0).toLocaleString()} member{group.members === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="group-information-description">
        <h3>Description</h3>
        <p>{group.description || 'Open this group to see its conversations, members, and latest posts.'}</p>
      </div>

      {Array.isArray(group.relatedGroups) && group.relatedGroups.length > 0 && (
        <div className="group-information-related">
          <h3>Related communities</h3>
          <div>{group.relatedGroups.slice(0, 8).map((related) => <span key={related}>{related}</span>)}</div>
        </div>
      )}

      <div className="group-information-actions">
        <button type="button" className={`btn ${isJoined ? 'btn-ghost' : 'btn-primary'}`} onClick={onJoin} disabled={joining}>
          {joining
            ? <span className={isJoined ? 'spinner spinner-primary' : 'spinner'} />
            : isJoined ? 'Leave group' : 'Join group'}
        </button>
        {group.isExternal && externalUrl && (
          <a className="btn btn-primary" href={externalUrl} target="_blank" rel="noopener noreferrer">
            Visit on {origin.label}
          </a>
        )}
        {onOpen && <button type="button" className="btn btn-outline" onClick={onOpen}>View group posts</button>}
      </div>
    </section>
  );
}
