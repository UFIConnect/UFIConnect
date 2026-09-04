import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
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

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

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

function CreateGroupModal({ categories, onClose, onCreate }) {
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

export function GroupsContent({ embedded = false }) {
  const navigate = useNavigate();
  const [groups,      setGroups]      = useState([]);
  const [joined,      setJoined]      = useState(new Set());
  const [categories,  setCategories]  = useState([]);
  const [filter,      setFilter]      = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [joiningId,   setJoiningId]   = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  const searchRef = useRef('');

  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce((query) => {
      searchRef.current = query.trim();
      setSearch(query.trim());
    }, 400),
    []
  );

  function loadGroups(bust = false) {
    if (bust) setRefreshing(true);
    else setLoading(true);
    setError(false);

    Promise.all([
      client.get(bust ? '/groups?bust=1' : '/groups'),
      client.get('/groups/categories'),
      client.get('/profile'),
    ])
      .then(([gRes, cRes, pRes]) => {
        setGroups(gRes.data.groups || []);
        setCategories(cRes.data.categories || []);
        setJoined(new Set(pRes.data.joinedGroups || []));
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
  }, []);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page — reuses the same bust path the manual Refresh button
  // already used, so it shows the same spinner rather than a full reload.
  useScrollToRefresh(() => loadGroups(true), { enabled: !loading && !refreshing });

  async function handleJoin(e, groupId) {
    e?.stopPropagation();
    if (joiningId) return;
    const isJoined = joined.has(groupId);
    setJoiningId(groupId);
    try {
      if (isJoined) {
        await client.delete(`/groups/${groupId}/join`);
        setJoined((prev) => {
          const s = new Set(prev);
          s.delete(groupId);
          return s;
        });
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, members: Math.max(0, g.members - 1) } : g
          )
        );
      } else {
        await client.post(`/groups/${groupId}/join`);
        setJoined((prev) => new Set([...prev, groupId]));
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, members: g.members + 1 } : g
          )
        );
      }
    } catch (err) {
      console.error('Failed to join/leave group:', err);
    } finally {
      setJoiningId(null);
    }
  }

  async function handleCreateGroup({ name, description, category, isPrivate }) {
    const { data } = await client.post('/groups', { name, description, category, isPrivate });
    setGroups((prev) => [data.group, ...prev]);
    setJoined((prev) => new Set([...prev, data.group.id]));
    setShowCreate(false);
    navigate(`/groups/${data.group.id}`);
  }

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byFilter = filter === 'all'
      ? groups
      : groups.filter((group) => group.category === filter);
    return q
      ? byFilter.filter((group) =>
          (group.name || '').toLowerCase().includes(q)
          || (group.description || '').toLowerCase().includes(q)
          || (group.category || '').toLowerCase().includes(q)
        )
      : byFilter;
  }, [filter, groups, search]);

  useEffect(() => {
    setSelectedGroupId((current) => (
      displayed.some((group) => group.id === current)
        ? current
        : (displayed[0]?.id || null)
    ));
  }, [displayed]);

  const selectedGroupIndex = Math.max(0, displayed.findIndex((group) => group.id === selectedGroupId));
  const selectedGroup = displayed[selectedGroupIndex] || null;

  function handleGroupTabKeyDown(event, index) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? displayed.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? Math.min(displayed.length - 1, index + 1)
          : Math.max(0, index - 1);
    const nextGroup = displayed[nextIndex];
    if (!nextGroup) return;
    setSelectedGroupId(nextGroup.id);
    document.getElementById(`group-directory-tab-${nextIndex}`)?.focus();
  }

  const ContentShell = embedded ? 'section' : Layout;

  return (
    <ContentShell className={embedded ? 'home-embedded-feed' : undefined}>
      <div
        className="page-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Discover Groups</h1>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
          style={{ marginTop: 0, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          + Create Group
        </button>
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Refresh groups"
          onClick={() => loadGroups(true)}
          disabled={refreshing}
          style={{
            marginTop: 0,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              animation: refreshing ? 'spin 1s linear infinite' : 'none',
            }}
          >
            ↻
          </span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
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

      {/* Search bar */}
      <div style={{ marginBottom: 16, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 13,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '1rem',
              pointerEvents: 'none',
              opacity: 0.5,
            }}
          >
            Q
          </span>
          <input
            className="form-input"
            placeholder="Search groups by name, category, or keyword…"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              debouncedSearch(e.target.value);
            }}
            style={{
              paddingLeft: 40,
              borderRadius: 22,
              fontSize: '.875rem',
            }}
            aria-label="Search groups"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchInput('');
                searchRef.current = '';
                setSearch('');
              }}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.2rem',
                color: 'var(--muted)',
                padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          marginBottom: 16,
          paddingBottom: 4,
          scrollbarWidth: 'none',
        }}
      >
        <button
          className={`filter-btn${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            padding: '7px 14px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: filter === 'all' ? 700 : 500,
            fontSize: '.8rem',
            border: `1.5px solid ${filter === 'all' ? 'var(--primary)' : 'var(--border)'}`,
            background:
              filter === 'all' ? 'var(--primary)' : 'var(--surface)',
            color: filter === 'all' ? '#fff' : 'var(--text)',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const isActive = filter === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
                padding: '7px 14px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: isActive ? 700 : 500,
                fontSize: '.8rem',
                border: `1.5px solid ${isActive ? meta?.text || 'var(--primary)' : 'var(--border)'}`,
                background: isActive
                  ? meta?.bg || 'var(--surface)'
                  : 'var(--surface)',
                color: isActive ? meta?.text || 'var(--primary)' : 'var(--text)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {meta?.icon} {cat}
            </button>
          );
        })}
      </div>

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
      {!loading && !error && displayed.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">Q</div>
          <div className="empty-title">
            {search ? 'No groups found' : 'No groups in this category'}
          </div>
          <div className="empty-desc">
            {search ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearchInput('');
                  searchRef.current = '';
                  setSearch('');
                }}
              >
                Clear search
              </button>
            ) : (
              <>Try a different category or search for something specific.</>
            )}
          </div>
        </div>
      )}

      {/* Selectable group directory */}
      {!loading && !error && displayed.length > 0 && (
        <div>
          <p
            style={{
              fontSize: '.8rem',
              color: 'var(--muted)',
              marginBottom: 16,
              fontWeight: 500,
            }}
          >
            {displayed.length} public communit
            {displayed.length !== 1 ? 'ies' : 'y'}
          </p>
          <div className="group-directory-browser">
            <div className="group-directory-list">
              <div className="group-directory-list-heading">
                <strong>Groups</strong>
                <span>{displayed.length.toLocaleString()}</span>
              </div>
              <div className="group-directory-tabs" role="tablist" aria-label="Groups">
                {displayed.map((group, index) => (
                  <GroupDirectoryTab
                    key={group.id}
                    group={group}
                    index={index}
                    selected={group.id === selectedGroup?.id}
                    onSelect={() => setSelectedGroupId(group.id)}
                    onKeyDown={(event) => handleGroupTabKeyDown(event, index)}
                  />
                ))}
              </div>
            </div>
            <GroupInformation
              group={selectedGroup}
              index={selectedGroupIndex}
              isJoined={joined.has(selectedGroup?.id)}
              joining={joiningId === selectedGroup?.id}
              onJoin={() => handleJoin(null, selectedGroup.id)}
              onOpen={() => navigate(`/groups/${selectedGroup.id}`)}
            />
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

function GroupDirectoryTab({ group, selected, index, onSelect, onKeyDown }) {
  const meta = CATEGORY_META[group.category] || { icon: 'GR' };
  const origin = groupOrigin(group);
  return (
    <button
      id={`group-directory-tab-${index}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="selected-group-information"
      tabIndex={selected ? 0 : -1}
      className={`group-directory-tab${selected ? ' active' : ''}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="group-directory-tab-mark" aria-hidden="true">{meta.icon}</span>
      <span className="group-directory-tab-copy">
        <strong>{group.name}</strong>
        <span>{group.category || 'Community'}</span>
        <small>{group.members?.toLocaleString() || 0} members - {origin.label}</small>
      </span>
    </button>
  );
}

function GroupInformation({ group, index, isJoined, joining, onJoin, onOpen }) {
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
      role="tabpanel"
      aria-labelledby={`group-directory-tab-${index}`}
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
        {!group.isExternal && <span>{isJoined ? 'Joined' : 'Available to join'}</span>}
      </div>

      <dl className="group-information-facts">
        <div><dt>Members</dt><dd>{group.members?.toLocaleString() || 0}</dd></div>
        <div><dt>Source</dt><dd>{origin.label}</dd></div>
        <div><dt>Category</dt><dd>{group.category || 'Community'}</dd></div>
        <div><dt>Access</dt><dd>{group.isPrivate ? 'Private' : 'Public'}</dd></div>
      </dl>

      <div className="group-information-description">
        <h3>About this group</h3>
        <p>{group.description || 'Open this group to see its conversations, members, and latest posts.'}</p>
      </div>

      {Array.isArray(group.relatedGroups) && group.relatedGroups.length > 0 && (
        <div className="group-information-related">
          <h3>Related communities</h3>
          <div>{group.relatedGroups.slice(0, 8).map((related) => <span key={related}>{related}</span>)}</div>
        </div>
      )}

      <div className="group-information-actions">
        {group.isExternal ? (
          <a className="btn btn-primary" href={externalUrl} target="_blank" rel="noopener noreferrer">
            Visit on {origin.label}
          </a>
        ) : (
          <>
            <button type="button" className={`btn ${isJoined ? 'btn-ghost' : 'btn-primary'}`} onClick={onJoin} disabled={joining}>
              {joining
                ? <span className={isJoined ? 'spinner spinner-primary' : 'spinner'} />
                : isJoined ? 'Leave group' : 'Join group'}
            </button>
            <button type="button" className="btn btn-outline" onClick={onOpen}>View group posts</button>
          </>
        )}
      </div>
    </section>
  );
}
