import AppearanceControl from '../components/AppearanceControl';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import './Policies.css';

export default function PolicyLayout({ title, description, path, children }) {
  return <div className="ufi-policy-page">
    <Helmet>
      <title>{`${title} | UFIConnect`}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`https://uficonnect.org${path}`} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={`${title} | UFIConnect`} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={`https://uficonnect.org${path}`} />
    </Helmet>
    <header className="ufi-policy-header">
      <Link className="ufi-policy-brand" to="/"><img src="/uficonnect-wordmark.svg?v=blue-ufi-20261006" alt="UFIConnect" width="180" height="36" /></Link>
      <nav aria-label="Public navigation"><div className="public-theme-control"><AppearanceControl compact /></div><Link to="/policies">Policies</Link><Link to="/login">Sign in</Link></nav>
    </header>
    <main className="ufi-policy-main" id="policy-content">
      <div className="ufi-policy-intro">
        <p className="ufi-policy-eyebrow">Trust and safety</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <p className="ufi-policy-updated">Updated October 5, 2026 · UFIConnect, California, United States</p>
      </div>
      {children}
    </main>
    <footer className="ufi-policy-footer">
      <Link to="/">Home</Link><Link to="/terms">Terms of Service</Link>
      <Link to="/privacy">Privacy Policy</Link><Link to="/policies">All policies</Link>
      <Link to="/copyright">Copyright</Link><Link to="/child-safety">Child safety</Link>
      <Link to="/privacy#analytics">Privacy choices</Link>
    </footer>
  </div>;
}

export function PolicySection({ id, title, children }) {
  return <section className="ufi-policy-section" id={id} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{title}</h2>{children}
  </section>;
}
