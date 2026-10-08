import { accountLocationBasisLabel, accountLocationCityLabel } from '../../../shared/accountLocation.js';

export default function AccountLocationNotice({ ranking, count }) {
  return <div className="account-location-notice" role="region" aria-label="Location based account ranking">
    <p className="account-location-city"><strong>City:</strong> {accountLocationCityLabel(ranking.data)}</p>
    {ranking.checking ? <p role="status">Finding sources for this location…</p> : ranking.error ? <>
      <p role="alert">{ranking.error}</p>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Retry location based accounts" onClick={ranking.refresh}>Retry</button>
    </> : ranking.data ? <>
      <p>{accountLocationBasisLabel(ranking.data)}</p>
      {!count && <p role="status">No matching sources for this location.</p>}
    </> : <p role="status">Location based accounts are unavailable.</p>}
  </div>;
}
