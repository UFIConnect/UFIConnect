import { Helmet } from 'react-helmet-async';
import { NavLink, Link } from 'react-router-dom';
import { ArrowRight, KeyRound, LockKeyhole, Power, ShieldCheck, Smartphone, Wifi } from 'lucide-react';
import Layout from '../components/Layout';
import './Vault.css';
import './VaultDevice.css';

export function VaultNavigation() {
  return <nav className="vault-navigation" aria-label="Vault pages">
    <NavLink to="/vault" end><KeyRound size={16} aria-hidden="true" />Your Vault</NavLink>
    <NavLink to="/vault/protect"><ShieldCheck size={16} aria-hidden="true" />UFI Protect</NavLink>
    <NavLink to="/vault/device"><LockKeyhole size={16} aria-hidden="true" />Device</NavLink>
  </nav>;
}

export function VaultCardDesign({ compact = false }) {
  return <div className={`vault-card-stage${compact ? ' vault-card-stage--compact' : ''}`} role="img" aria-label="UFI Vault Card design: black card, UFI logo, contactless symbol and an on/off button on the top edge. No exposed chip.">
    <div className="vault-card-design">
      <span className="vault-card-power" aria-hidden="true"><Power size={11} /></span>
      <span className="vault-card-surface" aria-hidden="true" />
      <div className="vault-card-brand" aria-hidden="true"><img src="/uficonnect-google-verification-icon.svg" alt="" /><strong>UFIconnect</strong><span>Vault Card</span></div>
      <Wifi className="vault-card-contactless" size={30} strokeWidth={1.3} aria-hidden="true" />
      <div className="vault-card-footer" aria-hidden="true"><span>YOUR WORLD. YOUR VAULT.</span><span>DESIGN PREVIEW</span></div>
    </div>
  </div>;
}

export default function VaultDevice() {
  return <Layout wide>
    <Helmet><title>Vault Device | UFIconnect</title><meta name="robots" content="noindex,nofollow" /></Helmet>
    <section className="vault-page vault-device-page" aria-labelledby="vault-device-page-title">
      <header className="vault-page-heading">
        <div><div className="vault-wordmark"><img src="/uficonnect-google-verification-icon.svg" width="24" height="24" alt="" /><span>UFI<span>connect</span></span><span className="vault-preview-badge">DEVICE PREVIEW</span></div><h1 id="vault-device-page-title">Your Vault. <span>In your hands.</span></h1><p>A physical companion for the apps and accounts you use.</p></div>
      </header>
      <VaultNavigation />

      <div className="vault-device-showcase">
        <figure className="vault-device-figure">
          <div className="vault-device-figure-label"><span>UFI VAULT CARD</span><span>01 / DESIGN CONCEPT</span></div>
          <VaultCardDesign />
          <figcaption><Power size={14} /><span>Top-edge on/off button. A clean front with no exposed chip.</span></figcaption>
        </figure>
        <section className="vault-device-order" aria-labelledby="vault-device-order-title">
          <span className="vault-device-release"><LockKeyhole size={13} aria-hidden="true" />Hardware locked</span>
          <h2 id="vault-device-order-title">Carry your connection.</h2>
          <p>A compact card concept that pairs with Your Vault. Choose your app and continue—the device is designed to handle the rest.</p>
          <dl><div><dt>Finish</dt><dd>Matte black concept</dd></div><div><dt>Control</dt><dd>Top-edge on/off button</dd></div><div><dt>Availability</dt><dd>To be announced</dd></div></dl>
          <button className="vault-button vault-button--secondary vault-button--full" type="button" disabled aria-describedby="vault-device-order-note"><LockKeyhole size={17} />Orders are not open yet</button>
          <p id="vault-device-order-note" className="vault-footnote">Pairing, hardware authentication and ordering are unavailable.</p>
          <Link className="vault-text-button" to="/vault">Explore Your Vault <ArrowRight size={14} /></Link>
        </section>
      </div>

      <section className="vault-device-flow" aria-labelledby="vault-device-flow-title">
        <div className="vault-device-section-heading"><div><span className="vault-eyebrow">THE PLANNED EXPERIENCE</span><h2 id="vault-device-flow-title">One step. Your app.</h2></div><p>You choose where to go. Your device takes care of the rest.</p></div>
        <ol><li><div className="vault-device-step-top"><Smartphone size={23} strokeWidth={1.5} /><span>01</span></div><h3>Choose your app and continue.</h3><p>Select an app or website saved in Your Vault. The planned device handles authentication and secure credential handoff for supported apps, so you can continue straight to what you need.</p><p className="vault-footnote">Design preview. Automatic sign-in requires the finished device and a supported app integration.</p><Link className="vault-text-button" to="/vault">View your saved apps <ArrowRight size={14} /></Link></li></ol>
      </section>

      <section className="vault-device-flow" aria-labelledby="vault-device-capabilities-title">
        <div className="vault-device-section-heading"><h2 id="vault-device-capabilities-title">Planned hardware features</h2></div>
        <ol>
          <li><h3>Device-backed sign-in</h3><p>Hardware passkeys, multi-factor approvals and proof that a registered device authorized an action.</p></li>
          <li><h3>Secure offline access</h3><p>Encrypted credentials, secure notes and documents with offline approval on supported devices.</p></li>
          <li><h3>Account recovery</h3><p>A recovery key for compatible accounts if a device is lost or replaced.</p></li>
        </ol>
      </section>

      <section className="vault-device-protection" aria-labelledby="vault-device-protection-title">
        <div className="vault-device-protection-icon"><ShieldCheck size={28} strokeWidth={1.5} /></div>
        <div><span className="vault-eyebrow">BUILT AROUND YOUR APPROVAL</span><h2 id="vault-device-protection-title">A timestamp is a record. Your key proves it’s you.</h2><p>Planned hardware verification uses a device key and a fresh, single-use challenge for each action. Timestamps alone cannot stop cloning or replay. This device flow stays locked until hardware pairing and security validation are complete.</p><p className="vault-footnote"><KeyRound size={13} /> Your existing browser vault works separately and can be unlocked with its passphrase or supported device verification.</p></div>
      </section>
    </section>
  </Layout>;
}
