import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';

const CATEGORY_META = {
  'AI & ML':     { icon: '🤖', bg: '#F3EEFF', text: '#7C3AED' },
  'Engineering': { icon: '💻', bg: '#EFF6FF', text: '#2563EB' },
  'Startups':    { icon: '🚀', bg: '#FFFBEB', text: '#D97706' },
  'Design':      { icon: '🎨', bg: '#FDF2F8', text: '#DB2777' },
  'Marketing':   { icon: '📈', bg: '#ECFDF5', text: '#059669' },
  'Finance':     { icon: '💰', bg: '#F0F9FF', text: '#0284C7' },
  'Remote Work': { icon: '🌍', bg: '#EEF2FF', text: '#4338CA' },
  'Education':   { icon: '🎓', bg: '#FFF7ED', text: '#EA580C' },
  'Social':      { icon: '🔗', bg: '#F9FAFB', text: '#6B7280' },
  'Health':      { icon: '🏃', bg: '#F0FDF4', text: '#16A34A' },
  'Climate':     { icon: '🌱', bg: '#ECFDF5', text: '#065F46' },
  'Food':        { icon: '🍳', bg: '#FFF7ED', text: '#C2410C' },
  'Travel':      { icon: '✈️', bg: '#F0F9FF', text: '#0369A1' },
  'Gaming':      { icon: '🎮', bg: '#F5F3FF', text: '#6D28D9' },
  'Music':       { icon: '🎵', bg: '#FDF4FF', text: '#A21CAF' },
  'Fashion':     { icon: '👗', bg: '#FFF1F2', text: '#BE123C' },
  'Lifestyle':   { icon: '🌟', bg: '#FFFFF0', text: '#92400E' },
  'Sports':      { icon: '⚽', bg: '#ECFDF5', text: '#047857' },
  'Space':       { icon: '🚀', bg: '#EEF2FF', text: '#3730A3' },
};

const PLATFORM_META = {
  reddit:      { icon: '🟠', label: 'Reddit',         color: '#FF4500' },
  discord:     { icon: '💬', label: 'Discord',        color: '#5865F2' },
  linkedin:    { icon: '💼', label: 'LinkedIn',       color: '#0A66C2' },
  hackernews:  { icon: '🔶', label: 'News',           color: '#FF6600' },
  devto:       { icon: '👩‍💻', label: 'DEV Community',  color: '#3B49DF' },
  github:      { icon: '🐙', label: 'GitHub',         color: '#24292F' },
  uficonnect:  { icon: '🌐', label: 'UFconnect',    color: '#6366F1' },
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
              { value: false, label: '🌐 Public', desc: 'Listed for everyone, anyone can join' },
              { value: true,  label: '🔒 Private', desc: 'Hidden from the directory — join by invite only' },
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
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Professional Communities & Groups | Connect with Your People on UFconnect</title>
        <meta name="description" content="Discover and connect with 50+ professional communities. Find Reddit communities, Discord servers, LinkedIn groups, Facebook Groups, Twitter communities, Hacker News, GitHub, and DEV.to — all curated by role and interests. Network with engineers, designers, founders, and creatives." />
        <meta name="keywords" content="professional communities, tech communities, developer groups, connect communities, networking groups, Discord communities, Reddit communities, LinkedIn groups, Facebook Groups, tech groups, engineering communities, design communities, startup communities, news communities, group networking, professional groups, career groups" />
        <link rel="canonical" href="https://uficonnect.org/groups" />
      </Helmet>
      {GroupsContent()}
    </>
  );
}

function GroupsContent() {
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
  const [lastRefresh, setLastRefresh] = useState(null);
  const [showCreate,  setShowCreate]  = useState(false);

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
        setLastRefresh(new Date());
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

  async function handleJoin(e, groupId) {
    e.stopPropagation();
    const isJoined = joined.has(groupId);
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
    }
  }

  async function handleCreateGroup({ name, description, category, isPrivate }) {
    const { data } = await client.post('/groups', { name, description, category, isPrivate });
    setGroups((prev) => [data.group, ...prev]);
    setJoined((prev) => new Set([...prev, data.group.id]));
    setShowCreate(false);
    navigate(`/groups/${data.group.id}`);
  }

  const q = search.trim().toLowerCase();
  const byFilter =
    filter === 'all' ? groups : groups.filter((g) => g.category === filter);
  const displayed = q
    ? byFilter.filter(
        (g) =>
          (g.name || '').toLowerCase().includes(q) ||
          (g.description || '').toLowerCase().includes(q) ||
          (g.category || '').toLowerCase().includes(q)
      )
    : byFilter;

  return (
    <Layout>
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
          <span>⚠️</span>
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
            🔍
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
          <div className="empty-icon">🔍</div>
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

      {/* Groups grid */}
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
          <div className="groups-grid">
            {displayed.map((group) => {
              const meta = CATEGORY_META[group.category] || {
                icon: '📌',
                bg: '#F1F5F9',
                text: '#64748B',
              };
              const isJoined = joined.has(group.id);
              const platMeta = group.platform
                ? PLATFORM_META[group.platform]
                : null;

              return (
                <div
                  key={group.id}
                  className="card group-card"
                  onClick={() =>
                    group.isExternal
                      ? window.open(
                          group.externalUrl,
                          '_blank',
                          'noopener,noreferrer'
                        )
                      : navigate(`/groups/${group.id}`)
                  }
                  style={{ cursor: 'pointer', position: 'relative' }}
                >
                  {/* Origin badge */}
                  {(() => {
                    const origin = group.isExternal
                      ? platMeta || PLATFORM_META.uficonnect
                      : PLATFORM_META.uficonnect;
                    return (
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          fontSize: '.65rem',
                          fontWeight: 700,
                          color: origin.color,
                          background: `${origin.color}18`,
                          padding: '2px 8px',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        {origin.icon} {origin.label}
                      </div>
                    );
                  })()}

                  {group.isPrivate && (
                    <div style={{
                      position: 'absolute', top: 10, left: 10,
                      fontSize: '.65rem', fontWeight: 700,
                      color: '#92400E', background: '#FEF3C7',
                      padding: '2px 8px', borderRadius: 4,
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}>
                      🔒 Private
                    </div>
                  )}

                  {/* Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '2rem',
                        flexShrink: 0,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3
                        style={{
                          fontSize: '.95rem',
                          fontWeight: 700,
                          margin: '0 0 4px',
                          lineHeight: 1.3,
                          paddingRight: group.isExternal ? 80 : 0,
                          color: 'var(--text)',
                        }}
                      >
                        {group.name}
                      </h3>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '.7rem',
                          fontWeight: 700,
                          background: meta.bg,
                          color: meta.text,
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}
                      >
                        {group.category}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <p
                    style={{
                      fontSize: '.85rem',
                      lineHeight: 1.5,
                      margin: '0 0 10px',
                      color: 'var(--text)',
                    }}
                  >
                    {group.description}
                  </p>

                  {/* Footer */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      paddingTop: 10,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '.75rem',
                        color: 'var(--muted)',
                        fontWeight: 500,
                      }}
                    >
                      👥 {group.members?.toLocaleString() || 0}
                    </span>
                    {group.isExternal ? (
                      <a
                        href={group.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="btn btn-sm btn-outline"
                        style={{
                          borderColor: platMeta?.color || 'var(--primary)',
                          color: platMeta?.color || 'var(--primary)',
                        }}
                      >
                        Visit →
                      </a>
                    ) : (
                      <button
                        className={`btn btn-sm${
                          isJoined ? ' btn-ghost' : ' btn-primary'
                        }`}
                        onClick={(e) => handleJoin(e, group.id)}
                        aria-label={
                          isJoined
                            ? `Leave ${group.name} group`
                            : `Join ${group.name} group`
                        }
                      >
                        {isJoined ? '✓ Joined' : 'Join'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Last refresh info */}
          {lastRefresh && (
            <div
              style={{
                textAlign: 'center',
                marginTop: 20,
                fontSize: '.75rem',
                color: 'var(--muted)',
              }}
            >
              Updated {new Date(lastRefresh).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </Layout>
  );
}
