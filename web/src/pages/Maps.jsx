import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import CategoryCity from '../components/SourceCity';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { SOURCE_META } from '../components/sourceMeta';
import { CITY_SOURCE_PRESETS, CITY_SOURCE_IDS, CITY_ALL_TOPICS, houseTopics } from '../local/citySources';
import client from '../api/client';
import { topicCount, topicTarget, fitsTopicTargets } from '../local/cityTopicTargets.mjs';
import { useAuth } from '../contexts/AuthContext';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { CITY_CATEGORIES, useLocalWorkspace, safeLink } from '../local/localWorkspace';
import '../components/local-workspaces.css';
import '../components/maps-workspace.css';

const DEFAULT_CITY = { enabled: CITY_CATEGORIES.map(category => category.id), limit: 250, selected: [] };
const PAGE_SIZE = 20;
const postKey = post => String(post.source || 'uficonnect') + ':' + String(post.id);
const sourceLabel = source => SOURCE_META[source]?.label || source;
const snapshot = (post, category) => ({
  key: postKey(post), id: String(post.id), source: String(post.source || 'uficonnect'),
  title: String(post.title || post.content || 'Community post').slice(0, 220),
  content: String(post.content || '').slice(0, 1800),
  topics: (Array.isArray(post.topics) ? post.topics : [post.topic]).filter(topic => typeof topic === 'string').slice(0, 30),
  sourceUrl: safeLink(post.sourceUrl), category, selectedAt: new Date().toISOString(),
});

export default function Maps() {
  const { profile } = useAuth();
  const city = useLocalWorkspace(profile.id, 'city', DEFAULT_CITY);
  const enabled = Array.isArray(city.value.enabled) ? city.value.enabled.filter(id => CITY_CATEGORIES.some(category => category.id === id)) : DEFAULT_CITY.enabled;
  const selected = Array.isArray(city.value.selected) ? city.value.selected.filter(post => post && typeof post.key === 'string').slice(0, 500) : [];
  const limit = [250, 350, 500].includes(city.value.limit) ? city.value.limit : 250;
  const sourceSelections = city.value.sourceSelections && typeof city.value.sourceSelections === 'object' && !Array.isArray(city.value.sourceSelections) ? city.value.sourceSelections : {};
  const topicSelections = city.value.topicSelections && typeof city.value.topicSelections === 'object' && !Array.isArray(city.value.topicSelections) ? city.value.topicSelections : {};
  const [active, setActive] = useState(enabled[0] || 'community');
  const [activeSource, setActiveSource] = useState('');
  const [view, setView] = useState('explore');
  const [posts, setPosts] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sample, setSample] = useState(false);
  const [topicSearch, setTopicSearch] = useState('');
  const topicTargets = city.value.topicTargets || {};
  const paging = useRef({ page: 1, cursor: '' });
  const request = useRef(null);
  const sequence = useRef(0);
  const heading = useRef(null);
  const housePanel = useRef(null);
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const sources = Array.isArray(sourceSelections[active])
    ? [...new Set(sourceSelections[active].filter(source => CITY_SOURCE_IDS.includes(source)))]
    : CITY_SOURCE_PRESETS[active] || ['uficonnect'];
  const currentSource = sources.includes(activeSource) ? activeSource : '';
  const topicKey = active + ':' + (currentSource || 'city');
  const availableTopics = [...new Set([...houseTopics(active, currentSource), ...CITY_ALL_TOPICS])];
  const topics = Array.isArray(topicSelections[topicKey])
    ? topicSelections[topicKey].filter(topic => availableTopics.includes(topic)) : [];
  const requestedSources = currentSource ? [currentSource] : sources;
  const sourceKey = requestedSources.join(',');
  const requestedTopics = topics.join(',');
  const primarySources = [...new Set([...(CITY_SOURCE_PRESETS[active] || []), ...sources])];
  const otherSources = CITY_SOURCE_IDS.filter(source => !primarySources.includes(source));
  const counts = useMemo(() => selected.reduce((result, post) => {
    if (post.category === active) result[post.source] = (result[post.source] || 0) + 1;
    return result;
  }, {}), [selected, active]);
  const cityCounts = selected.reduce((all, post) => ({ ...all, [post.category]: (all[post.category] || 0) + 1 }), {});
  const cityLimits = city.value.cityLimits || {};
  const citySelected = cityCounts[active] || 0;
  const cityLimit = [50, 100, 250, 350, 500].includes(cityLimits[active]) ? Math.max(cityLimits[active], citySelected) : [50, 100, 250, 350, 500].find(value => value >= citySelected) || 500;
  const selectedKeys = new Set(selected.map(post => post.key));
  const currentPosts = view === 'selected' ? selected.filter(post => !query.trim() || (post.title + ' ' + post.content).toLowerCase().includes(query.trim().toLowerCase())) : posts;
  const pages = Math.max(1, Math.ceil(currentPosts.length / PAGE_SIZE));
  const visible = currentPosts.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
  function saveCity(changes) {
    return city.save({ ...city.value, enabled, limit, selected, sourceSelections, topicSelections, cityLimits, topicTargets, ...changes, updatedAt: new Date().toISOString() });
  }
  async function load(reset = false) {
    if (!reset && loading) return 0;
    if (!sourceKey || !enabled.includes(active)) return 0;
    const id = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    if (reset) { paging.current = { page: 1, cursor: '' }; setPosts([]); setPage(1); }
    setLoading(true); setError('');
    try {
      const params = { mode: category.mode || 'feed', sources: sourceKey, q: query.trim(), limit: 40, sort: 'newest', page: paging.current.page };
      if (requestedTopics) params.topics = requestedTopics;
      if (paging.current.cursor) params.cursor = paging.current.cursor;
      const { data } = await client.get('/office/feed', { params, signal: controller.signal });
      if (id !== sequence.current) return 0;
      const incoming = Array.isArray(data.posts) ? data.posts.filter(post => post?.id != null && requestedSources.includes(String(post.source || 'uficonnect').toLowerCase())).map(post => snapshot(post, active)) : [];
      setPosts(current => {
        const seen = new Set(reset ? [] : current.map(post => post.key));
        return [...(reset ? [] : current), ...incoming.filter(post => { if (seen.has(post.key)) return false; seen.add(post.key); return true; })].slice(0, 500);
      });
      paging.current = { page: paging.current.page + 1, cursor: data.cursor || '' };
      setHasMore(data.hasMore === true && (reset ? incoming.length : posts.length + incoming.length) < 500);
      setSample(data.sampleContent === true);
      return incoming.length;
    } catch (failure) {
      if (id === sequence.current && !controller.signal.aborted) setError('This category could not load. Retry to keep exploring.');
      return 0;
    } finally { if (id === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (view !== 'explore') return;
    if (!enabled.includes(active) || !sourceKey) { setPosts([]); setHasMore(false); setPage(1); setError(''); return; }
    const timer = setTimeout(() => load(true), 200);
    return () => { clearTimeout(timer); sequence.current++; request.current?.abort(); setLoading(false); };
  }, [active, query, view, enabled.includes(active), sourceKey, requestedTopics]);
  useScrollToRefresh(() => load(true), { enabled: view === 'explore' && enabled.includes(active) && Boolean(sourceKey) && !loading });
  function chooseCategory(id) { setActive(id); setActiveSource(''); setView('explore'); setQuery(''); setPage(1); }
  function openHouse(source) { setActiveSource(source); setView('explore'); setQuery(''); setPage(1); }
  useEffect(() => {
    if (!currentSource || view !== 'explore') return;
    housePanel.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [currentSource, view]);
  function setSources(next) {
    if (saveCity({ sourceSelections: { ...sourceSelections, [active]: next } }) && !next.includes(activeSource)) setActiveSource('');
  }
  function toggleSource(source) {
    setSources(sources.includes(source) ? sources.filter(item => item !== source) : [...sources, source]);
  }
  function toggleTopic(topic) {
    const next = topics.includes(topic) ? topics.filter(item => item !== topic) : [...topics, topic];
    saveCity({ topicSelections: { ...topicSelections, [topicKey]: next } });
  }
  function sourceButton(source) {
    return <button key={source} type="button" className={'search-filter-chip city-source-chip' + (sources.includes(source) ? ' active' : '')} aria-pressed={sources.includes(source)} onClick={() => toggleSource(source)}>
      <span className="city-source-mark">{hasBrandIcon(source) ? <BrandIcon platform={source} size={17} /> : String(SOURCE_META[source]?.icon || source).slice(0, 3)}</span>{sourceLabel(source)}
    </button>;
  }
  function toggleCategory(id) {
    const next = enabled.includes(id) ? enabled.filter(item => item !== id) : [...enabled, id];
    if (saveCity({ enabled: next }) && !next.includes(active)) { setActive(next[0] || 'community'); setActiveSource(''); }
  }
  function setTopicTarget(topic, next) {
    if (!Number.isInteger(next) || next < 1 || next > 500) return;
    const savedCount = topicCount(selected, topic, active, currentSource);
    if (next < savedCount) return setNotice('This topic already has ' + savedCount + ' saved posts. Remove posts before lowering the target.');
    saveCity({ topicTargets: { ...topicTargets, [topicKey]: { ...topicTargets[topicKey], [topic]: next } }, cityLimits: { ...cityLimits, [active]: [50, 100, 250, 350, 500].find(value => value >= Math.max(cityLimit, next)) || 500 }, limit: Math.max(limit, next <= 250 ? 250 : next <= 350 ? 350 : 500) });
  }
  const houseSummaries = Object.fromEntries(sources.map(source => [source, (topicSelections[active + ':' + source] || []).map(topic => ({ topic, count: topicCount(selected, topic, active, source), loaded: topicCount(posts, topic, active, source), target: topicTarget(topicTargets, active + ':' + source, topic) }))]));
  function togglePost(post) {
    setNotice('');
    if (selectedKeys.has(post.key)) saveCity({ selected: selected.filter(item => item.key !== post.key) });
    else if (!fitsTopicTargets(post, selected, active, topicSelections, topicTargets)) setNotice('A selected topic has reached its post target. Increase its target to save more.');
    else if (citySelected >= cityLimit) setNotice('Increase this city’s post target to save more posts here.');
    else if (selected.length >= limit) setNotice('Your selection is full. Choose a larger limit or remove a post.');
    else saveCity({ selected: [...selected, post] });
  }
  function selectPage() {
    const additions = visible.filter(post => !selectedKeys.has(post.key));
    const available = Math.max(0, Math.min(limit - selected.length, cityLimit - citySelected));
    const next = [];
    for (const post of additions) { if (next.length < available && fitsTopicTargets(post, [...selected, ...next], active, topicSelections, topicTargets)) next.push(post); }
    if (saveCity({ selected: [...selected, ...next] })) setNotice(next.length + ' posts added.' + (additions.length > available ? ' A city, topic, or collection target was reached.' : ''));
  }
  async function nextPage() {
    if (page < pages) setPage(page + 1);
    else if (view === 'explore' && hasMore && await load()) setPage(page + 1);
    heading.current?.focus();
  }
  return <Layout wide feedSearch={{ query, label: 'Search city posts', onSubmit: value => { setQuery(value); setPage(1); } }}>
    <Helmet><title>Maps · Your city | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="local-workspace city-workspace">
      <header className="local-workspace-heading"><div><span className="local-eyebrow">YOUR WORLD, CONNECTED</span><h1>Maps</h1><p>Choose a city, open its source houses, and save posts about the topics you enjoy.</p></div><span className="local-status-pill">{selected.length} / {limit} posts selected</span></header>
      <ol className="map-get-started"><li><b>1</b><span>Choose your city<small>A landscape for every interest</small></span></li><li><b>2</b><span>Open source houses<small>Pick the topics inside</small></span></li><li><b>3</b><span>Grow your collection<small>Raise your target and save posts</small></span></li></ol>
      <CategoryCity houseSummaries={houseSummaries} cityCounts={cityCounts} enabled={enabled} active={active} onSelect={chooseCategory} counts={counts} sources={enabled.includes(active) ? sources : []} activeSource={currentSource} onSourceSelect={openHouse} />
      <section className="card map-city-budget" aria-label="City post target">
        <div><span className="local-eyebrow">{category.label} collection</span><h2>{citySelected} / {cityLimit} posts saved</h2><p>{sources.length} sources · {topics.length || 'Any'} topics · {posts.length} matching posts loaded</p><progress max={cityLimit} value={citySelected} aria-label={category.label + ' saved post target'} /></div>
        <label className="local-field">Posts from this city<select value={cityLimit} onChange={event => {
          const next = Number(event.target.value);
          if (citySelected > next) return setNotice('Remove some posts from this city before lowering its target.');
          saveCity({ cityLimits: { ...cityLimits, [active]: next }, limit: Math.max(limit, next) });
        }}>{[50, 100, 250, 350, 500].map(value => <option key={value} value={value}>{value} posts</option>)}</select><small>Raising a target makes room; select posts below to fill it.</small></label>
      </section>
      <details className="card city-customize"><summary>Customize your app</summary>
        <p>Choose your nature neighborhoods, add source houses, and keep up to 500 posts in your personal selection. Changes are saved for your account in this browser.</p>
        <div className="local-chip-row">{CITY_CATEGORIES.map(item => <label key={item.id} className="local-check-chip"><input type="checkbox" checked={enabled.includes(item.id)} onChange={() => toggleCategory(item.id)} />{item.label}</label>)}</div>
        <label className="local-field">Post selection limit<select value={limit} onChange={event => {
          const next = Number(event.target.value);
          if (selected.length > next) setNotice('Remove some selected posts before reducing your limit.');
          else saveCity({ limit: next });
        }}><option value="250">250 posts</option><option value="350">350 posts</option><option value="500">500 posts</option></select></label>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => saveCity({ enabled: DEFAULT_CITY.enabled })}>Restore all categories</button>
      </details>
      {enabled.includes(active) && <section className="card city-source-picker" aria-labelledby="city-sources-heading">
        <div className="local-workspace-heading"><div><h2 id="city-sources-heading">Sources</h2><p>Each source gets a house in {category.label}. Open its house to choose the topics inside.</p></div>
          <button type="button" className="ufi-clear-control" disabled={!sources.length} onClick={() => setSources([])}>Clear</button>
        </div>
        <div className="local-chip-row" role="group" aria-label={category.label + ' sources'}>{primarySources.map(sourceButton)}</div>
        {otherSources.length > 0 && <details className="city-more-sources"><summary>More sources ({otherSources.length})</summary><div className="local-chip-row">{otherSources.map(sourceButton)}</div></details>}
      </section>}
      {enabled.includes(active) && view === 'explore' && <section ref={housePanel} id="city-source-house" className="card city-house-topics" aria-labelledby="house-topics-heading">
        <div className="local-workspace-heading"><div><span className="local-eyebrow">{currentSource ? 'INSIDE THE HOUSE' : 'CITY TOPICS'}</span><h2 id="house-topics-heading">{currentSource ? sourceLabel(currentSource) : category.label} · Topics</h2></div>
          {currentSource && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveSource('')}>Back to city topics</button>}
        </div>
        <p className="local-muted">{currentSource ? 'These topics apply to this source house.' : 'These topics apply across the sources in this city.'} Clear topics to broaden your selection.</p>
        <div className="map-selected-topics" aria-label="Selected topics">
          <div className="local-workspace-heading"><h3>Selected topics ({topics.length})</h3><button type="button" className="ufi-clear-control" disabled={!topics.length} onClick={() => saveCity({ topicSelections: { ...topicSelections, [topicKey]: [] } })}>Clear topics</button></div>
          {!topics.length && <p className="local-muted">No topics selected. This house currently shows any topic. Add topics below to build your selection.</p>}
          {topics.map(topic => { const count = topicCount(selected, topic, active, currentSource), loaded = topicCount(posts, topic, active, currentSource), target = topicTarget(topicTargets, topicKey, topic); return <div key={topic} className="map-topic-row">
            <div><strong>{topic}</strong><span>{loaded} loaded · {count} saved / {target} target</span></div>
            <div className="map-topic-counter"><button type="button" aria-label={'Fewer ' + topic + ' posts'} disabled={target <= Math.max(1, count)} onClick={() => setTopicTarget(topic, Math.max(1, count, target - 5))}>−</button><label>Post target<input type="number" min={Math.max(1, count)} max="500" key={topic + ':' + target} defaultValue={target} aria-label={topic + ' post target'} onBlur={event => { const next = Math.min(500, Math.max(1, count, Math.round(Number(event.target.value) || target))); event.target.value = next; setTopicTarget(topic, next); }} /></label><button type="button" aria-label={'More ' + topic + ' posts'} disabled={target >= 500} onClick={() => setTopicTarget(topic, Math.min(500, target + 5))}>+</button></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleTopic(topic)}>Remove</button>
          </div>; })}
          <p className="local-muted">Counts describe posts loaded in this view and saved in your collection, not every post on the platform. Topic targets control how many matching posts you can save. A post matching multiple selected topics counts toward each.</p>
        </div>
        <details className="map-more-topics" open={!topics.length || undefined}><summary>Add more topics</summary><label className="local-field">Find a topic<input type="search" value={topicSearch} onChange={event => setTopicSearch(event.target.value)} placeholder="Search topics across categories" /></label><div className="local-chip-row" role="group" aria-label="Available house topics">
          {availableTopics.filter(topic => !topics.includes(topic) && topic.toLowerCase().includes(topicSearch.toLowerCase())).map(topic => <button type="button" key={topic} className="search-filter-chip" onClick={() => toggleTopic(topic)}>+ {topic}</button>)}
        </div></details>

      </section>}
      <div className="local-workspace-heading"><h2 ref={heading} tabIndex={-1}>{view === 'selected' ? 'Your selected posts' : currentSource ? sourceLabel(currentSource) + ' posts' : category.label + ' · Source posts'}</h2><div className="local-chip-row">
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={view === 'selected'} onClick={() => { setView(view === 'selected' ? 'explore' : 'selected'); setPage(1); }}>Your selection ({selected.length})</button>
        {view === 'explore' && sourceKey && <Link className="btn btn-ghost btn-sm" to={'/?feed=' + (category.mode || 'feed') + '&sources=' + encodeURIComponent(sourceKey)}>Open source feed</Link>}
        {view === 'explore' && <button type="button" className="btn btn-ghost btn-sm" disabled={loading || !enabled.includes(active) || !sourceKey} onClick={() => load(true)}>Refresh</button>}
      </div></div>
      {sample && view === 'explore' && <p className="local-muted">Sample posts for local review. The public website is unchanged.</p>}
      {(error || city.error) && <p className="local-error" role="alert">{error || city.error}{error && <button type="button" disabled={loading} onClick={() => load(true)}>Retry</button>}</p>}
      {notice && <p role="status" className="local-muted">{notice}</p>}
      <div className="local-chip-row">{view === 'explore' && <button type="button" className="btn btn-ghost btn-sm" disabled={!visible.length || selected.length >= limit || citySelected >= cityLimit} onClick={selectPage}>Save this page to {category.label}</button>}
        {view === 'selected' && selected.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm('Clear your selected posts?')) saveCity({ selected: [] }); }}>Clear selection</button>}</div>
      <div className="city-post-grid" aria-busy={loading}>{(view === 'selected' || enabled.includes(active)) && visible.map(post => <article className="card city-post" key={post.key}>
        <label className="city-post-select"><input type="checkbox" checked={selectedKeys.has(post.key)} onChange={() => togglePost(post)} aria-label={'Select ' + post.title} /><span>{sourceLabel(post.source)}</span></label>
        <h3>{post.title}</h3><p>{post.content}</p>{safeLink(post.sourceUrl) && <a href={safeLink(post.sourceUrl)} target="_blank" rel="noopener noreferrer">Open post</a>}
      </article>)}</div>
      {loading && <p role="status">Loading posts…</p>}
      {!loading && (!currentPosts.length || (view === 'explore' && !enabled.length)) && <p className="card">{view === 'selected' ? 'Select posts from your city to build your collection.' : !enabled.length ? 'Choose at least one category in Customize your app.' : !sourceKey ? 'Choose a source above to add its house and explore its posts.' : 'No posts match this source and topic selection yet. Try another house or clear its topics.'}</p>}
      <nav className="local-pagination" aria-label="City post pages"><button type="button" className="btn btn-ghost btn-sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {Math.min(page, pages)}</span><button type="button" className="btn btn-ghost btn-sm" disabled={loading || (page >= pages && (view === 'selected' || !hasMore))} onClick={nextPage}>Next</button></nav>
    </div>
  </Layout>;
}
