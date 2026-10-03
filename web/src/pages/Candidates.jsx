import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';

export default function Candidates() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResults(null);
    client.get('/users/search', { signal: controller.signal, params: { q: query, limit: 20, offset: page * 20 } })
      .then(({ data }) => { if (!controller.signal.aborted) setResults(data); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.response?.data?.error || 'Candidate search is unavailable. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, retry]);
  const people = (results?.users || []).filter(person => !person.isSelf);
  return <Layout>
    <Helmet><title>Find candidates | UFIconnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Candidate sourcing</span><h1>Find people for your next role</h1><p>Search discoverable UFIconnect profiles by name, job title, organization, or skill. Candidates control the profile information they share.</p></header>
    <form className="recruiting-search" onSubmit={event => { event.preventDefault(); setPage(0); setQuery(draft.trim()); }}>
      <input aria-label="Search candidates" value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} placeholder="Role, skill, company, or name" />
      <button className="btn btn-primary">Search</button>
    </form>
    {loading && <p role="status">Finding candidates…</p>}
    {error && <div role="alert"><p>{error}</p><button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!loading && !error && people.length === 0 && <p>No candidates found. Try a different role or skill.</p>}
    <section className="recruiting-candidates" aria-label="Candidate results" aria-busy={loading}>
      {people.map(person => <article className="recruiting-candidate" key={person.id}>
        <h2>{person.name}</h2><p>{[person.title || person.role, person.organization].filter(Boolean).join(' · ') || 'UFIconnect member'}</p>
        {person.bio && <p>{person.bio}</p>}
        {person.skills?.length > 0 && <div aria-label="Skills">{person.skills.map(skill => <span className="tag" key={skill}>{skill}</span>)}</div>}
        <Link className="btn btn-primary btn-sm" to={'/messages/' + encodeURIComponent(person.id)}>Contact about a role</Link>
      </article>)}
    </section>
    {(page > 0 || results?.hasMore) && <nav className="recruiting-pagination" aria-label="Candidate pages">
      <button className="btn btn-ghost" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span>
      <button className="btn btn-ghost" disabled={loading || !results?.hasMore} onClick={() => setPage(value => value + 1)}>Next</button>
    </nav>}
  </Layout>;
}
