import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import BrandIcon from '../components/BrandIcon';
import { SOURCE_META } from '../components/sourceMeta';
import { useAuth } from '../contexts/AuthContext';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import client from '../api/client';
import './People.css';

const FEED_SOURCES = ['uficonnect', 'github', 'bluesky'];
const NETWORKS = {
  linkedin: 'https://www.linkedin.com/search/results/people/',
  twitter: 'https://x.com/explore', facebook: 'https://www.facebook.com/search/people/',
  instagram: 'https://www.instagram.com/explore/', tiktok: 'https://www.tiktok.com/explore',
  youtube: 'https://www.youtube.com/', reddit: 'https://www.reddit.com/',
  gitlab: 'https://gitlab.com/explore', medium: 'https://medium.com/',
  dribbble: 'https://dribbble.com/', twitch: 'https://www.twitch.tv/directory',
  threads: 'https://www.threads.com/', mastodon: 'https://mastodon.social/explore',
  pinterest: 'https://www.pinterest.com/', tumblr: 'https://www.tumblr.com/explore',
  wordpress: 'https://wordpress.com/read', devto: 'https://dev.to/',
  stackoverflow: 'https://stackoverflow.com/users', hackernews: 'https://news.ycombinator.com/',
  lobsters: 'https://lobste.rs/', producthunt: 'https://www.producthunt.com/',
  indiehackers: 'https://www.indiehackers.com/', behance: 'https://www.behance.net/',
  hashnode: 'https://forum.freecodecamp.org/', yc: 'https://www.ycombinator.com/',
  crunchbase: 'https://www.crunchbase.com/',
};
const label = key => SOURCE_META[key]?.label || ({ twitch: 'Twitch', threads: 'Threads' }[key]) || key;
const safeAvatar = url => /^https:\/\//i.test(url || '') || /^\//.test(url || '') ? url : '';
const initials = name => String(name || '').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();

export default function People() {
  const { profile } = useAuth();
  const interests = profile?.preferences?.interests || [];
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [sources, setSources] = useState(FEED_SOURCES);
  const [people, setPeople] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [followBusy, setFollowBusy] = useState({});
  const paging = useRef({});
  const requestId = useRef(0);
  const busy = useRef(false);
  const sentinel = useRef(null);
  const sourceKey = sources.join(',');
  const defaultTopic = interests[0] || 'community';
  const load = useCallback(async (reset = false) => {
    if (!reset && busy.current) return;
    const seq = ++requestId.current;
    busy.current = true; setLoading(true);
    if (reset) { paging.current = {}; setErrors({}); setPeople([]); }
    const selected = sourceKey.split(',').filter(Boolean);
    const requested = selected.filter(source => reset || paging.current[source]?.hasMore);
    const chunks = await Promise.all(requested.map(async source => {
      const previous = paging.current[source] || { offset: 0, page: 1, cursor: '' };
      try {
        const params = source === 'uficonnect'
          ? new URLSearchParams({ sort: 'interests', limit: '20', offset: String(previous.offset), q: query.trim() || topic })
          : new URLSearchParams({ source, q: query.trim(), topic: topic || defaultTopic, page: String(previous.page), cursor: previous.cursor });
        const { data } = await client.get((source === 'uficonnect' ? '/users/search?' : '/people/external?') + params);
        if (seq !== requestId.current) return [];
        const users = (data.users || []).filter(user => source !== 'uficonnect' || !user.isSelf);
        paging.current[source] = {
          offset: previous.offset + (data.users || []).length, page: previous.page + 1,
          cursor: data.cursor || '', hasMore: data.hasMore === true,
        };
        setErrors(current => { const next = { ...current }; delete next[source]; return next; });
        return users.map(user => ({ ...user, source, feedId: source + ':' + user.id }));
      } catch (failure) {
        if (seq === requestId.current) {
          paging.current[source] = { ...previous, hasMore: false };
          setErrors(current => ({ ...current, [source]: failure.response?.data?.message || failure.response?.data?.error || 'Could not load this source.' }));
        }
        return [];
      }
    }));
    if (seq !== requestId.current) return;
    const incoming = [];
    for (let index = 0; index < Math.max(0, ...chunks.map(chunk => chunk.length)); index++) {
      chunks.forEach(chunk => { if (chunk[index]) incoming.push(chunk[index]); });
    }
    setPeople(current => {
      const merged = reset ? [] : [...current];
      const seen = new Set(merged.map(person => person.feedId));
      incoming.forEach(person => { if (!seen.has(person.feedId)) { merged.push(person); seen.add(person.feedId); } });
      return merged;
    });
    setHasMore(selected.some(source => paging.current[source]?.hasMore));
    busy.current = false; setLoading(false);
  }, [sourceKey, query, topic, defaultTopic]);
  useEffect(() => {
    const timer = setTimeout(() => load(true), 250);
    return () => { clearTimeout(timer); requestId.current++; busy.current = false; };
  }, [load]);
  useEffect(() => {
    if (!hasMore || loading || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) load(); }, { rootMargin: '300px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, load]);
  const refresh = useScrollToRefresh(() => load(true), { enabled: !loading });
  function toggleSource(source) {
    setSources(current => current.includes(source) ? current.filter(item => item !== source) : [...current, source]);
  }
  async function follow(person) {
    if (followBusy[person.id]) return;
    setFollowBusy(current => ({ ...current, [person.id]: true }));
    try {
      if (person.isFollowing) await client.delete('/users/' + encodeURIComponent(person.id) + '/follow');
      else await client.post('/users/' + encodeURIComponent(person.id) + '/follow');
      setPeople(current => current.map(item => item.feedId === person.feedId ? { ...item, isFollowing: !person.isFollowing } : item));
    } catch { setErrors(current => ({ ...current, follow: 'Could not update this follow. Please try again.' })); }
    finally { setFollowBusy(current => ({ ...current, [person.id]: false })); }
  }
  return <Layout feedSearch={{ query, label: 'Search people', onSubmit: setQuery }}>
    <Helmet><title>People | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <main className="people-feed">
      <header className="people-feed-heading">
        <div><h1 className="page-title">People</h1><p>Find people around your interests and build your community.</p></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(true)} disabled={loading}>Refresh</button>
      </header>
      <nav className="people-group-actions" aria-label="People and groups">
        <Link to="/search?tab=groups" className="btn btn-ghost btn-sm">Find groups</Link>
        <Link to="/search?tab=groups&create=1" className="btn btn-ghost btn-sm">Create a group</Link>
        <Link to="/profile?tab=about" className="btn btn-ghost btn-sm">Your interests</Link>
      </nav>
      <section className="card people-feed-options" aria-label="People feed sources">
        <div className="people-option-row">{FEED_SOURCES.map(source => <button type="button" key={source}
          className={'search-filter-chip' + (sources.includes(source) ? ' active' : '')}
          aria-pressed={sources.includes(source)} onClick={() => toggleSource(source)}>
          <BrandIcon platform={source} size={17} />{label(source)}
        </button>)}</div>
        {interests.length > 0 && <div className="people-topic-row" aria-label="Your interests">
          <button type="button" className="ufi-clear-control" disabled={!topic} onClick={() => setTopic('')}>Clear</button>
          {interests.map(value => <button type="button" key={value} className={'search-filter-chip' + (topic === value ? ' active' : '')}
            aria-pressed={topic === value} onClick={() => setTopic(current => current === value ? '' : value)}>{value}</button>)}
        </div>}
        <p>UFIconnect members are ranked by shared interests. Public profiles from other sources are matched to your search or selected interest.</p>
        {!interests.length && <p>Add interests to your profile to personalize your recommendations.</p>}
        <details className="people-networks">
          <summary>More networks ({Object.keys(NETWORKS).length})</summary>
          <p>Explore people on these networks. These links open each platform; their profiles aren’t imported into this feed.</p>
          <div className="people-network-grid">{Object.entries(NETWORKS).map(([source, url]) =>
            <a key={source} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              <BrandIcon platform={source} size={16} />Open {label(source)}
            </a>)}</div>
        </details>
      </section>
      {(refresh.pulling || refresh.refreshing) && <div role="status" className="scroll-refresh-status">Refreshing people…</div>}
      {Object.entries(errors).map(([source, error]) => <div role="status" className="card" key={source}>
        <strong>{source === 'follow' ? 'Follow' : label(source)}</strong>: {error}
        {source !== 'follow' && <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => load(true)}>Retry</button>}
      </div>)}
      {!sources.length && <div className="card">Select a feed source above, or explore another network.</div>}
      {!loading && sources.length > 0 && !people.length && !Object.keys(errors).length && <div className="card">No people found. Try another interest or search.</div>}
      <div className="search-people-results">{people.map(person => {
        const native = person.source === 'uficonnect';
        return <article className="card search-person-card" key={person.feedId}>
          <div className="avatar avatar-md search-result-avatar">{initials(person.name)}{safeAvatar(person.avatarUrl) &&
            <img src={safeAvatar(person.avatarUrl)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</div>
          <div className="search-person-body">
            <div className="search-person-topline">
              <div className="search-person-name-wrap">
                {native ? <Link className="search-profile-link" to={'/u/' + encodeURIComponent(person.id)}>{person.name}</Link>
                  : <a className="search-profile-link" href={person.profileUrl} target="_blank" rel="noopener noreferrer">{person.name}</a>}
                <span>{person.title || ''}</span>
              </div>
              <span className="tag">{label(person.source)}</span>
            </div>
            {person.bio && <p className="search-person-bio">{person.bio}</p>}
            {native && person.sharedInterests?.length > 0 && <div className="search-person-skills">
              {person.sharedInterests.map(value => <Link key={value} className="tag tag-secondary"
                to={'/search?tab=groups&q=' + encodeURIComponent(value)}>{value}</Link>)}
            </div>}
            {!native && <p className="people-discovery-reason">{person.discoveryReason}</p>}
            <div className="search-person-actions people-card-actions">
              {native ? <>
                <button type="button" className="btn btn-ghost btn-sm" disabled={followBusy[person.id]} onClick={() => follow(person)}>{person.isFollowing ? 'Following' : 'Follow'}</button>
                <Link className="btn btn-ghost btn-sm" to={'/messages/' + encodeURIComponent(person.id)}>Message</Link>
              </> : <a className="btn btn-ghost btn-sm" href={person.profileUrl} target="_blank" rel="noopener noreferrer">View on {label(person.source)}</a>}
            </div>
          </div>
        </article>;
      })}</div>
      {loading && <p role="status">Loading people…</p>}
      {hasMore && <div ref={sentinel} className="people-feed-more"><button type="button" className="btn btn-ghost" disabled={loading} onClick={() => load()}>More people</button></div>}
    </main>
  </Layout>;
}

