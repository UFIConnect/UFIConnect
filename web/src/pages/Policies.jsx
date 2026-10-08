import { Link } from 'react-router-dom';
import PolicyLayout, { PolicySection } from './PolicyLayout';

const sections = [
  ['community', 'Community guidelines'], ['acceptable-use', 'Acceptable use'],
  ['reporting', 'Reports and appeals'], ['connected-services', 'Connected services and attribution'],
  ['developer-api', 'Developer and API access'], ['law-enforcement', 'Legal requests'],
  ['retention', 'Data retention and deletion'], ['security', 'Security and incident reports'],
  ['age', 'Age requirements'], ['advertising', 'Advertising and tracking'],
];

export default function Policies() {
  return <PolicyLayout title="Policies and safety" path="/policies"
    description="The rules for using UFIConnect, how connected services work, and how to report a concern or manage your data.">
    <nav className="ufi-policy-index" aria-label="Policy directory">
      <h2>Find a policy</h2>
      <ul>
        <li><Link to="/terms">Terms of Service</Link></li>
        <li><Link to="/privacy">Privacy Policy</Link></li>
        <li><Link to="/copyright">Copyright and DMCA requests</Link></li>
        <li><Link to="/child-safety">Child Safety Standards</Link></li>
        {sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
      </ul>
    </nav>

    <PolicySection id="community" title="Community guidelines">
      <p>UFIConnect brings together public source content, member communities, professional connections and recruiting tools. Be accurate about your identity, respect others, and share only content you have permission to use.</p>
      <ul>
        <li>No threats, targeted harassment, hate directed at protected groups, scams, impersonation, or disclosure of another person’s private information.</li>
        <li>No child sexual abuse or exploitation, grooming, sextortion, or sexualized depictions of minors, including synthetic material.</li>
        <li>No non-consensual intimate imagery, sexual deepfakes, or tools and instructions intended to create or distribute them. This applies to uploaded content and AI features.</li>
        <li>Respect copyright, source attribution, consent and source safety labels. Do not evade a block, removal or account restriction.</li>
        <li>Recruiters must describe real opportunities accurately, respect applicants’ privacy, and follow applicable employment and discrimination rules.</li>
      </ul>
      <p>Violations may lead to content removal, feature restrictions or account suspension. Serious harm can lead to termination without a warning.</p>
    </PolicySection>

    <PolicySection id="acceptable-use" title="Acceptable use">
      <p>Use the service for lawful communication, discovery and work. Do not steal credentials, distribute malware, bypass access controls, overload systems, send spam, or collect personal information for surveillance or exploitation.</p>
      <p>AI tools must not be used for abuse, non-consensual sexual content, deceptive impersonation or infringing material. Review generated output before sharing it. UFIConnect does not use Google APIs to create non-consensual intimate imagery.</p>
      <p>A connected account, subscription or public source link does not grant permission to scrape a source, download restricted media, remove branding, resell data or circumvent that source’s restrictions.</p>
    </PolicySection>

    <PolicySection id="reporting" title="Reports and appeals">
      <p>Open the post, comment or profile menu and choose <strong>Report</strong>. Select the closest reason and describe the problem. For copyright requests, use the <Link to="/copyright">copyright process</Link>. If a report control is unavailable, email <a href="mailto:support@uficonnect.org">support@uficonnect.org</a> with the UFIConnect link and original source link.</p>
      <p>Submitted in-app reports are stored for operator review with the target, reason, details and status. Filing a report does not automatically remove content. Review may result in action, a request for more information, or no action. Source platforms control removal from their own services.</p>
      <p>To appeal a restriction or follow up, contact support with the affected account, content link and the reason you believe the decision should change. Do not include passwords, access tokens or copies of illegal sexual material. For immediate danger, contact local emergency services.</p>
    </PolicySection>

    <PolicySection id="connected-services" title="Connected services, trademarks and attribution">
      <p>UFIConnect is an independent service. Source names and logos identify where content comes from; they do not imply endorsement, partnership or ownership. Content belongs to its author or other rights holder. Open the source link for the original context, current engagement counts and any source-specific restrictions.</p>
      <p>Connections are optional and depend on each provider’s availability and approval. Each provider has its own permissions, publishing capabilities, rate limits and content rules. A displayed like count is a source or UFIConnect count, as labelled; viewing it does not perform a like on that platform.</p>
      <p>Notifications and Messages can show private updates from supported connected inboxes. A connection may need additional authorization for inbox access. Read status is tracked in UFIConnect; replies, older history and the source’s own read status remain on that service. Each inbox identifies sources that need reconnection or must be opened directly.</p>
      <p>Read the permissions on the provider’s authorization screen. Disconnect in Connected Accounts or revoke access through the provider. Disconnecting stops future authorized access; it does not undo content you already published there. Details of storage and deletion are in the <Link to="/privacy">Privacy Policy</Link>.</p>
      <p>YouTube features use YouTube API Services and the official embedded player. The <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy">Google Privacy Policy</a> apply. Google user data is used for the authorized visible features, subject to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including applicable Limited Use requirements. It is not used for advertising or training general-purpose AI models.</p>
    </PolicySection>

    <PolicySection id="developer-api" title="Developer and API access">
      <p>The endpoints used by UFIConnect’s clients are part of the service. Their existence does not grant unrestricted third-party API access or a data redistribution licence. Contact <a href="mailto:support@uficonnect.org">support@uficonnect.org</a> before building an integration.</p>
      <p>Authorized integrations must use their own credentials, request only needed permissions, respect rate limits and revocation, protect user data, and preserve source attribution. Never bypass authentication, reuse another person’s tokens, probe other accounts, or present yourself as UFIConnect or a source platform.</p>
    </PolicySection>

    <PolicySection id="law-enforcement" title="Law-enforcement and other legal requests">
      <p>Send legal or preservation requests to <a href="mailto:privacy@uficonnect.org">privacy@uficonnect.org</a>. Identify the requesting authority, jurisdiction, legal basis, relevant account identifiers, requested records and date range, and provide official contact details and process documents.</p>
      <p>Requests are subject to identity, authority and scope review. Disclosure requires an applicable legal basis; submitting a request does not provide direct access to accounts. Preservation requests concern records still held by UFIConnect and cannot recover deleted records or decrypt a local Vault without its passphrase. Applicable law may limit notice to an affected user.</p>
      <p>This mailbox is not an emergency dispatch service. Contact emergency services for immediate threats to life or safety.</p>
    </PolicySection>

    <PolicySection id="retention" title="Data retention and deletion">
      <p>Retention depends on the feature and storage location. The following describes the implemented lifecycle. Cleanup can be delayed during an outage; a cache refresh interval is not a promise that every stored copy has been deleted.</p>
      <div className="ufi-policy-table-wrap">
        <table className="ufi-policy-table">
          <thead><tr><th scope="col">Data</th><th scope="col">Lifecycle and controls</th></tr></thead>
          <tbody>
            <tr><th scope="row">Account and member content</th><td>Kept to operate your account. Successful account deletion removes your account, authored posts and comments, account-linked messages and associated records from active application storage. Shared communities and other members’ content remain.</td></tr>
            <tr><th scope="row">Connected credentials</th><td>Removed from the active connection when disconnected or when the account is deleted. Revoke the provider’s grant separately if needed.</td></tr>
            <tr><th scope="row">Private message files</th><td>New UFIConnect message attachments require authenticated storage and participant access. Account deletion queues removal of sender-owned files; failed deletion retries. Abandoned uploads are scheduled for cleanup after 24 hours. Cleanup records may be retained until old upload signatures expire.</td></tr>
            <tr><th scope="row">Snaps</th><td>Public or followers-only photo and video Snaps stop displaying after 24 hours or when deleted. Scheduled cleanup removes uploaded media and clears its caption and links; failed cleanup retries. A small cleanup record remains for seven days to prevent reuse of a deleted upload. Account exports include your Snaps; account deletion also schedules removal of their media.</td></tr>
            <tr><th scope="row">Connected inboxes</th><td>Private source responses are temporarily cached in server memory and expire automatically. Disconnecting stops authorized retrieval and display. Message bodies are not stored in the inbox database. Opaque item identifiers and read timestamps remember your local read status; these records are included in account exports and deleted with the account.</td></tr>
            <tr><th scope="row">Source snapshots and actions</th><td>Creator metrics snapshots expire from storage after one day; source action request and audit records after 30 days. Snapshots stop displaying after 15 minutes until refreshed. These records are pruned when cleanup runs.</td></tr>
            <tr><th scope="row">Copyright concerns</th><td>Creator analytics concerns are pruned after 90 days. In-app safety reports and correspondence are separate records used to review concerns and resolve disputes; they do not share that automatic expiry.</td></tr>
            <tr><th scope="row">Public feed cache</th><td>Live feed age limits are generally 8 or 20 days depending on source volume and type. Archived items have a configurable age limit, 30 days by default, and count limits. Source restrictions and removals can require earlier deletion.</td></tr>
            <tr><th scope="row">Service counts</th><td>Anonymous daily page and performance totals are retained from May 2026. Earlier recorded totals may be recovered where available. In-memory request and response-time counters reset when the process restarts.</td></tr>
            <tr><th scope="row">Local Vault and downloads</th><td>Encrypted browser Vault data remains on that browser until you delete it or clear its storage. Account deletion does not remotely erase browser copies or exported files. Use Vault’s deletion controls and delete backups you no longer need.</td></tr>
            <tr><th scope="row">Billing, hosting logs and backups</th><td>Payment providers and hosting services maintain separate records under their own retention settings and applicable obligations. Account deletion does not erase those records immediately. Contact privacy support for a request involving these copies.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Use Settings → Account to export or delete account data, and Connected Accounts to disconnect a provider. Account deletion first stops recurring memberships; if this cannot finish, the app reports a failure so you can retry. Contact <a href="mailto:privacy@uficonnect.org">privacy@uficonnect.org</a> for access, correction, deletion or retention questions. Required legal or dispute records may need separate review.</p>
    </PolicySection>

    <PolicySection id="security" title="Security and incident reporting">
      <p>Report suspected security issues privately to <a href="mailto:privacy@uficonnect.org">privacy@uficonnect.org</a>. Include the affected page, time, impact and safe steps to reproduce with a test account. Do not send secrets, exploit another user’s account, or publish personal data.</p>
      <p>For suspected account compromise, change your password and revoke sessions in Security settings. Disconnect affected external accounts and revoke access with those providers. Incident handling includes assessing the report, containing confirmed exposure, reviewing affected systems and providing notices when applicable law requires them. This does not guarantee a particular response time or that an incident can be fully reversed.</p>
      <p>The local Vault encrypts private entries in your browser. Keep your passphrase and backups safe; support cannot recover a forgotten passphrase. Hardware device protection is described separately on the <Link to="/vault-device">Vault device page</Link>.</p>
    </PolicySection>

    <PolicySection id="age" title="Children and age requirements">
      <p>UFIConnect is intended for people aged 13 and over, or 16 and over in the EU, EEA and UK, and any higher minimum required where they live. It is not directed to younger children. Do not misrepresent your age or use another person’s identity to register.</p>
      <p>Report an underage account or a concern involving a child to <a href="mailto:support@uficonnect.org">support@uficonnect.org</a>. See the <Link to="/child-safety">Child Safety Standards</Link> for prohibited conduct and reporting options.</p>
    </PolicySection>

    <PolicySection id="advertising" title="Advertising, sponsored content and tracking">
      <p>Clearly identify paid endorsements, sponsorships and affiliate relationships in content you post. Do not disguise an advertisement as an independent recommendation or imply that UFIConnect or a source platform endorses a sponsor.</p>
      <p>Optional Google Analytics measures general page categories after analytics consent. A separate Google Ads choice allows measurement of visits and ad click attribution on the public homepage for signed-out visitors. Accepting one does not accept the other. Google receives connection and device information and, for Ads, permitted ad click identifiers and attribution cookies. Ad personalization is disabled.</p>
      <p><Link to="/privacy#analytics">Manage analytics and advertising choices</Link>. Declining or withdrawing consent stops future collection by that optional integration. Global Privacy Control keeps both optional integrations off. Core service counts and security controls continue. The <Link to="/privacy">Privacy Policy</Link> describes cookies, local storage and providers.</p>
    </PolicySection>
  </PolicyLayout>;
}
