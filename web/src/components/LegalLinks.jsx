import { Link } from 'react-router-dom';
import './LegalLinks.css';

export default function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Policies and support">
      <Link to="/privacy">Privacy policy</Link>
      <Link to="/privacy#analytics">Analytics privacy</Link>
      <Link to="/policies">Policies and safety</Link>
      <Link to="/copyright">Copyright / DMCA</Link>
      <Link to="/terms">Terms of use</Link>
      <a href="mailto:support@uficonnect.org">Contact support</a>
      <details className="legal-links-safety">
        <summary>Safety and help</summary>
        <div>
          <Link to="/child-safety">Child safety standards</Link>
          <a href="mailto:support@uficonnect.org?subject=Safety%20concern">Report a safety concern</a>
        </div>
      </details>
    </nav>
  );
}
