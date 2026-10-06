import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight, FileKey2, ScanFace, HardDriveDownload, KeyRound, LockKeyhole, Power, Wifi } from 'lucide-react';
import PublicOverviewLayout from './PublicOverviewLayout';

export default function VaultDeviceOverview() {
  return <PublicOverviewLayout>
    <Helmet>
      <title>UFI Vault Device Preview | UFIconnect</title>
      <meta name="description" content="Explore the UFI Vault Card design concept, see what the browser Vault offers today, and learn which hardware features are still in development." />
      <link rel="canonical" href="https://uficonnect.org/vault-device" />
      <meta property="og:title" content="UFI Vault Device Preview | UFIconnect" />
      <meta property="og:description" content="A look at the planned Vault Card and the browser Vault available today. Hardware orders are not open." />
      <meta property="og:url" content="https://uficonnect.org/vault-device" />
      <meta property="og:type" content="website" />
    </Helmet>

    <section className="public-overview-hero public-overview-hero--device" aria-labelledby="vault-overview-title">
      <div>
        <span className="public-overview-eyebrow">UFI Vault / Device preview</span>
        <h1 id="vault-overview-title">Your Vault.<br /><span>A physical companion.</span></h1>
        <p className="public-overview-lead">Import your passwords once. Let the planned UFI Vault Card handle supported sign-ins for you.</p>
        <p>The physical card is in development. Hardware pairing, automatic sign-in, pricing and a release date are still pending.</p>
        <div className="public-overview-actions">
          <a className="public-overview-button" href="#available-now">See what is available <ArrowRight size={17} aria-hidden="true" /></a>
          <span className="public-overview-status">Hardware orders are not open</span>
        </div>
      </div>
      <figure className="public-vault-concept">
        <div className="public-vault-illustration" role="img" aria-label="Design concept of a matte black UFI Vault Card, with a top-edge power button and a contactless symbol.">
          <span className="public-vault-power" aria-hidden="true"><Power size={12} /></span>
          <div className="public-vault-wordmark" aria-hidden="true"><img src="/uficonnect-mark.svg?v=blue-ufi-20261006" width="48" height="48" alt="" /><span>UFI<span>connect</span></span><strong>Vault Card</strong></div>
          <Wifi className="public-vault-contactless" size={36} aria-hidden="true" />
          <span className="public-vault-card-label" aria-hidden="true">DESIGN CONCEPT</span>
        </div>
        <figcaption>Proposed appearance. Final design and specifications may change.</figcaption>
      </figure>
    </section>

    <section id="available-now" className="public-overview-section" aria-labelledby="vault-now-title">
      <span className="public-overview-eyebrow">Available today</span>
      <h2 id="vault-now-title">Start with your browser Vault.</h2>
      <p className="public-overview-intro">The browser Vault works separately from the planned card. Sign in to create a Vault with a $3.94 USD monthly membership.</p>
      <div className="public-overview-grid public-overview-grid--three">
        <article className="public-overview-card"><KeyRound aria-hidden="true" /><h3>Passwords, documents and keys</h3><p>Keep encrypted items in this browser, separated by your UFIconnect account. Unlock with your passphrase or supported device verification.</p></article>
        <article className="public-overview-card"><HardDriveDownload aria-hidden="true" /><h3>Import, export and delete</h3><p>Import supported CSV or JSON password exports from Android, Windows, Linux and iOS. Export passwords or an encrypted backup, and remove items when you choose.</p></article>
        <article className="public-overview-card"><FileKey2 aria-hidden="true" /><h3>Keep a recovery copy</h3><p>Vault items stay in this browser, with no automatic cloud sync. Keep an encrypted backup and your passphrase separately before changing devices or clearing browser data.</p></article>
      </div>
      <div className="public-overview-note">
        <LockKeyhole size={22} aria-hidden="true" />
        <div><h3>Know what your membership includes</h3><p>$3.94 USD per month, renewing until canceled; applicable tax is shown at checkout. An active membership is needed to create a Vault or add, edit and import items. You can still unlock, read, export, restore or delete existing items after it ends.</p><p>UFI VPN connections are not available yet. The membership includes access when service setup is complete. The physical Vault Card is not included.</p></div>
      </div>
      <Link className="public-overview-button" to="/vault">Open your browser Vault <ArrowRight size={17} aria-hidden="true" /></Link>
    </section>

    <section className="public-overview-section" aria-labelledby="vault-plan-title">
      <span className="public-overview-eyebrow">The planned device experience</span>
      <h2 id="vault-plan-title">Turn on. Authenticate. Automate your logins.</h2>
      <p className="public-overview-intro">After setup, the device is intended to handle sign-ins across your imported accounts. You authenticate when it turns on; supported apps then request the credentials they need. This hardware workflow is planned and is not active in the browser Vault.</p>
      <div className="public-overview-note"><HardDriveDownload size={24} aria-hidden="true" /><div><h3>First-time setup: import and delete</h3><p>Turn on the device and authenticate with Face ID on a supported Apple device. Import your passwords, confirm the import succeeded and keep an encrypted recovery backup. Then delete the temporary password export and any source copies you choose to remove.</p><p>Deletion is a separate, explicit choice after verification. The planned device must not delete originals before confirming the import and recovery copy.</p></div></div>
      <ol className="public-overview-flow public-overview-flow--four" aria-label="Planned Vault Card flow">
        <li><span className="public-overview-step-number">01</span><Power aria-hidden="true" /><h3>Turn on the device</h3><p>Power on manually, or open a supported app to trigger the planned automatic wake-up. Saved credentials remain locked until you authenticate.</p></li>
        <li><span className="public-overview-step-number">02</span><ScanFace aria-hidden="true" /><h3>Authenticate with Face ID</h3><p>Use Face ID on compatible Apple hardware to authorize access when the device turns on. This approval unlocks the planned login workflow.</p></li>
        <li><span className="public-overview-step-number">03</span><KeyRound aria-hidden="true" /><h3>Automate imported logins</h3><p>Vault fetches each supported app’s authentication request, matches it to the imported account and completes the sign-in. The workflow is intended to work across all imported accounts with supported integrations, without retyping their passwords.</p></li>
        <li><span className="public-overview-step-number">04</span><Power aria-hidden="true" /><h3>Shut down automatically</h3><p>After completing the sign-in, the device powers off automatically. Opening another supported app starts the flow again when a login is needed.</p></li>
      </ol>
      <p className="public-overview-caption">Face ID requires compatible Apple hardware. Authentication on Android, Windows and Linux, device pairing, recovery and automatic sign-in integrations still need to be developed and validated. Password changes and account recovery may still require your attention.</p>
    </section>

    <section className="public-overview-section" aria-labelledby="vault-security-title">
      <span className="public-overview-eyebrow">Security design</span>
      <h2 id="vault-security-title">Why the workflow requires authentication</h2>
      <p className="public-overview-intro">Face ID verifies your approval to use Vault. The destination service still verifies its own account credentials and may request another factor. Importing a password does not bypass that service’s security checks.</p>
      <div className="public-overview-grid public-overview-grid--three">
        <article className="public-overview-card"><LockKeyhole aria-hidden="true" /><h3>Protect stored credentials</h3><p>The device design calls for encrypted credential storage and access gated by authentication. Encryption keys, pairing and recovery must be implemented and independently tested before hardware protection can be claimed.</p></article>
        <article className="public-overview-card"><ScanFace aria-hidden="true" /><h3>Keep biometric verification local</h3><p>On supported Apple hardware, Face ID matches your face within the device’s security system. Apps receive the authentication result, not the stored facial template. <a href="https://support.apple.com/guide/security/facial-matching-security-sece151358d1/web" target="_blank" rel="noopener noreferrer">Apple’s Face ID security explanation</a>.</p></article>
        <article className="public-overview-card"><FileKey2 aria-hidden="true" /><h3>Match each request to its account</h3><p>The planned integration must verify the requesting app or website before using its matching credential. It should release only what that sign-in needs, clear temporary access and shut down after completing the operation.</p></article>
      </div>
      <p className="public-overview-caption">Automatic shutdown reduces the time the device is active; it does not replace encryption, trusted pairing or recovery safeguards. Multi-factor prompts, expired passwords and unsupported login flows can still require action. These are design requirements for the planned device, not completed hardware certifications.</p>
    </section>

    <section className="public-overview-section public-overview-faq" aria-labelledby="vault-questions-title">
      <h2 id="vault-questions-title">Before you get started</h2>
      <details><summary>Can I buy or pair the physical card now?</summary><p>No. Ordering and hardware pairing are not available. Hardware integration, recovery, security validation and availability must be completed before launch. This preview collects no hardware payment or shipping information.</p></details>
      <details><summary>Does a browser membership provide hardware protection?</summary><p>The current Vault encrypts items locally in your browser. The planned card has not been connected to that flow. Browser device unlock, where supported, is a separate feature; it does not mean a UFI Vault Card has been paired.</p></details>
      <details><summary>Can the website read my phone or computer's password store?</summary><p>No. Export a supported file from your existing password manager, then select it in Vault. You review the entries before importing. A password CSV is unencrypted, so delete that temporary file after use and keep encrypted backups for recovery.</p></details>
      <details><summary>Where can I review privacy and subscription terms?</summary><p>Read the <Link to="/privacy">Privacy Policy</Link> and <Link to="/terms">Terms of Use</Link>. You can manage or cancel your membership in Vault or Settings.</p></details>
    </section>
  </PublicOverviewLayout>;
}
