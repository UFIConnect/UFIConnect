import { useEffect, useRef, useState } from 'react';
import { count } from './analytics-model.mjs';

const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count(value));
const share = (value, total) => total ? `${(value / total * 100).toFixed(1)}%` : '0.0%';

export default function AnalyticsGeography({ apiBase, request, filters, refreshRevision, active = true }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [geography, setGeography] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), generation = useRef(0);
  const { platform, category, viewType, start, end } = filters;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(), current = ++generation.current;
    setGeography(null); setError(''); setBusy(true);
    const invalidate = () => { generation.current++; controller.abort(); setGeography(null); setError(''); setBusy(true); };
    window.addEventListener('office-token-changed', invalidate);
    const query = new URLSearchParams({ from: start, to: end, platform, category, viewType });
    request(`${apiBase}/office/analytics/geography?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (response.status === 401 || response.status === 403) throw new Error('Office access is required to load geographic counts.');
        if (!response.ok || data.available !== true || !Array.isArray(data.countries) || !Array.isArray(data.cities)) {
          throw new Error(data.error || 'Geographic counts are unavailable. Deploy the matching API and retry.');
        }
        if (generation.current === current && !controller.signal.aborted) setGeography(data);
      })
      .catch(error => { if (generation.current === current && !controller.signal.aborted) setError(error.message || 'Geographic counts could not be loaded.'); })
      .finally(() => { if (generation.current === current && !controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); window.removeEventListener('office-token-changed', invalidate); };
  }, [apiBase, request, platform, category, viewType, start, end, refreshRevision, retry, active]);
  const cityRows = (geography?.cities || []).filter(row => `${row.city} ${row.region} ${row.countryName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(cityRows.length / 20)), currentPage = Math.min(page, pages);
  const shown = cityRows.slice((currentPage - 1) * 20, currentPage * 20);

  return <section aria-labelledby="analytics-geography-heading">
    <div className="office-analytics-section-heading"><div><h2 id="analytics-geography-heading">Activity by country and city</h2>
      <p>Page, screen and tab opens for the selected dates and filters. Locations are approximate network locations; repeated opens count separately.</p></div></div>
    {busy && <p role="status">Loading geographic counts…</p>}
    {error && <div role="alert" className="office-analytics-error"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry geographic counts</button></div>}
    {geography && <>
      <p className="office-analytics-meta">{start} through {end} · {number(geography.total)} opens · Country known for {number(geography.knownCountry)} · City known for {number(geography.knownCity)}.</p>
      <p className="office-analytics-meta">{geography.firstRecordedDay ? `First location count in this selection: ${geography.firstRecordedDay}. ` : 'No verified location counts have been recorded for this selection. '}Older opens and requests without a verified location appear as unknown.{!geography.cityHeadersEnabled ? ' City reporting is waiting for verified city headers from the network provider.' : ''} Geography uses its own refreshed snapshot.</p>
      <div className="office-analytics-two-columns">
        <section className="office-analytics-card" aria-labelledby="analytics-country-heading"><h2 id="analytics-country-heading">By country</h2>
          <div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label="Country activity table">
            <table><thead><tr><th scope="col">Country</th><th scope="col">Opens</th><th scope="col">Share</th></tr></thead><tbody>
              {geography.countries.map(row => <tr key={row.country}><th scope="row">{row.label}</th><td>{number(row.views)}</td><td>{share(row.views, geography.total)}</td></tr>)}
              <tr><th scope="row">Unknown country</th><td>{number(geography.unknownCountry)}</td><td>{share(geography.unknownCountry, geography.total)}</td></tr>
            </tbody><tfoot><tr><th scope="row">Total opens</th><td>{number(geography.total)}</td><td>{geography.total ? '100.0%' : '0.0%'}</td></tr></tfoot></table>
          </div>
        </section>
        <section className="office-analytics-card" aria-labelledby="analytics-city-heading"><h2 id="analytics-city-heading">By city</h2>
          <label>Find a city<input type="search" placeholder="City, region or country" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
          <div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label="City activity table">
            <table><thead><tr><th scope="col">City</th><th scope="col">Opens</th><th scope="col">Share</th></tr></thead><tbody>
              {shown.map(row => <tr key={row.key}><th scope="row">{row.city}<small>{[row.region, row.countryName].filter(Boolean).join(', ')}</small></th><td>{number(row.views)}</td><td>{share(row.views, geography.total)}</td></tr>)}
              {!search && <tr><th scope="row">Unknown city</th><td>{number(geography.unknownCity)}</td><td>{share(geography.unknownCity, geography.total)}</td></tr>}
              {!search && geography.otherCityViews > 0 && <tr><th scope="row">Additional recorded cities</th><td>{number(geography.otherCityViews)}</td><td>{share(geography.otherCityViews, geography.total)}</td></tr>}
            </tbody></table>
          </div>
          {search && !cityRows.length && <p>No recorded cities match this search.</p>}
          {pages > 1 && <nav className="office-analytics-section-heading" aria-label="City pages"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous cities</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next cities</button></nav>}
          <p className="office-analytics-meta">{number(cityRows.length)} cities shown across {pages} {pages === 1 ? 'page' : 'pages'}. Unknown city: {number(geography.unknownCity)} opens across all selected activity.</p>
          {geography.cityCount > geography.cityLimit && <p className="office-analytics-meta">The {number(geography.cityLimit)} busiest cities are listed from {number(geography.cityCount)} recorded cities. Additional cities account for {number(geography.otherCityViews)} opens. Country totals include every recorded city.</p>}
        </section>
      </div>
    </>}
  </section>;
}
