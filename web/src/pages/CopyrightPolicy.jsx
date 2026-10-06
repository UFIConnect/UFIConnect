import { Link } from 'react-router-dom';
import PolicyLayout, { PolicySection } from './PolicyLayout';

export default function CopyrightPolicy() {
  return <PolicyLayout title="Copyright and takedown requests" path="/copyright"
    description="How to report copyright infringement, respond to a removal, or raise a concern about material shown on UFIConnect.">
    <PolicySection id="contact" title="Report a copyright concern">
      <p>Send complaints to <a href="mailto:support@uficonnect.org?subject=Copyright%20request">support@uficonnect.org</a> with the subject “Copyright request”. You do not need a UFIConnect account to contact us. Include the UFIConnect page and the original source URL so the material can be located.</p>
      <p>UFIConnect operates under its trade name in California, United States. We can review material hosted or displayed through our service. A source platform controls its original copy; reporting here does not submit a notice to that platform.</p>
      <p className="ufi-policy-callout">The in-app Report option and creator copyright concern form are ways to flag content for review. They do not by themselves submit a complete DMCA notice or automatically remove content.</p>
    </PolicySection>

    <PolicySection id="notice" title="What to include in a notice">
      <p>If you own the copyright or are authorized to act for its owner, provide:</p>
      <ol>
        <li>Your name, postal address, telephone number and email address.</li>
        <li>A description of the protected work, or a representative list if multiple works are involved.</li>
        <li>The exact location of each allegedly infringing item on UFIConnect and enough detail to identify it.</li>
        <li>A statement that you believe in good faith that the challenged use lacks permission from the rights holder, its representative or the law.</li>
        <li>A statement that your information is accurate and, under penalty of perjury, that you are authorized to act for the owner.</li>
        <li>Your physical or electronic signature.</li>
      </ol>
      <p>Consider licences, permission and applicable exceptions such as fair use before submitting. Knowingly false claims can have legal consequences. The <a href="https://www.copyright.gov/512/index.html">U.S. Copyright Office explains the notice process</a>.</p>
    </PolicySection>

    <PolicySection id="review" title="Review and removal">
      <p>We review whether the information identifies a copyright claim and the affected material. We may ask for missing details, remove or restrict access where appropriate, and notify the member responsible when contact information is available and notice is permitted.</p>
      <p>A complaint is an allegation, not a court ruling. A takedown in UFIConnect does not delete the original from an external source. Source links, identifiers and a description are usually sufficient to investigate; do not send unnecessary personal information or copies of illegal material.</p>
    </PolicySection>

    <PolicySection id="counter-notice" title="Respond to a removal">
      <p>If your material was removed in error, reply to the removal communication or email support with the subject “Copyright counter-notice”. Identify the removed item, its former location and your contact details.</p>
      <p>A formal DMCA counter-notice also needs your signature, a statement under penalty of perjury that removal resulted from mistake or misidentification, and consent to the relevant U.S. federal court’s jurisdiction and to accept service from the claimant or its agent. U.S. residents identify the district covering their address; residents outside the U.S. consent to a district where the service provider may be found.</p>
      <p>A valid counter-notice may be shared with the claimant, including the contact details it requires. Under the statutory process, restoration normally occurs between 10 and 14 business days after receipt unless notice of a qualifying court action is received. Separate safety or terms violations may still restrict the content. See <a href="https://www.govinfo.gov/content/pkg/USCODE-2024-title17/html/USCODE-2024-title17-chap5-sec512.htm">17 U.S.C. § 512(g)</a>.</p>
    </PolicySection>

    <PolicySection id="repeat-infringement" title="Repeat infringement">
      <p>Repeated copyright violations can lead to restrictions or account termination in appropriate circumstances. Review considers the notices, responses, reversals and available evidence; repeated unsupported accusations alone do not establish infringement. Do not create another account to evade a restriction.</p>
    </PolicySection>

    <PolicySection id="records" title="Request records and privacy">
      <p>Review may require retaining the notice, affected links, correspondence, action taken and any response or appeal to resolve the claim and related disputes. Information may be shared with the affected member, claimant or authorities when needed for the process or required by law. Do not include passwords, access tokens or unrelated sensitive information.</p>
      <p>Creator analytics copyright concerns have a separate 90-day cleanup period. That expiry does not promise deletion of formal complaint correspondence or records needed for a dispute. See our <Link to="/privacy">Privacy Policy</Link> and <Link to="/policies#retention">retention information</Link>. For harassment, impersonation or other safety concerns, use the <Link to="/policies#reporting">reporting and appeals process</Link>.</p>
    </PolicySection>
  </PolicyLayout>;
}
