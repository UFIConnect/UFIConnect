import { BellRing, ChevronDown, CreditCard, ExternalLink, FileText, HeartHandshake, LockKeyhole, ScanFace, Shield, ShieldCheck } from 'lucide-react';
import { isNativeRuntime, nativeExternalOpen, reportNativeError } from '../nativeRuntime.mjs';

const FTC_IDENTITY = 'https://consumer.ftc.gov/articles/what-know-about-identity-theft';
const EXPERIAN_IDENTITY = 'https://www.experian.com/protection/identity-theft-and-credit-protection';

const CREDIT_TOOLS = [
  {
    title: 'Credit monitoring', Icon: BellRing,
    description: 'Enroll for alerts about changes to your credit file.',
    links: [
      ['Experian monitoring', 'https://www.experian.com/credit/credit-monitoring/'],
      ['TransUnion monitoring', 'https://www.transunion.com/free-credit-monitoring'],
      ['Equifax Credit Monitor (paid)', 'https://www.equifax.com/personal/products/lock-and-monitor-credit/'],
    ],
  },
  {
    title: 'Credit reports and scores', Icon: FileText,
    description: 'Request your credit reports or find your score.',
    links: [
      ['Get free credit reports', 'https://www.annualcreditreport.com/index.action'],
      ['Find your score with TransUnion', 'https://www.transunion.com/credit-help'],
      ['CFPB credit score guide', 'https://www.consumerfinance.gov/ask-cfpb/where-can-i-get-my-credit-scores-en-316/'],
    ],
  },
  {
    title: 'Bank and credit card monitoring', Icon: CreditCard,
    description: 'Set up transaction alerts in your bank or card issuer’s app.',
    links: [['FTC guidance on unfamiliar activity', FTC_IDENTITY]],
  },
  {
    title: 'Security freeze', Icon: LockKeyhole,
    description: 'Place or lift a free freeze directly with each credit bureau.',
    links: [
      ['Equifax security freeze', 'https://www.equifax.com/personal/credit-report-services/credit-freeze/'],
      ['Experian security freeze', 'https://www.experian.com/help/credit-freeze/'],
      ['TransUnion security freeze', 'https://www.transunion.com/credit-freeze'],
    ],
  },
  {
    title: 'Credit lock', Icon: LockKeyhole,
    description: 'Manage a bureau’s credit lock service. Provider terms and fees may apply.',
    links: [
      ['Equifax Lock & Alert', 'https://www.equifax.com/personal/help/article-list/-/h/a/lock-equifax-credit-report/'],
      ['Experian CreditLock (paid)', 'https://www.experian.com/protection/creditlock/'],
    ],
  },
  {
    title: 'Fraud alerts', Icon: Shield,
    description: 'Ask one bureau to place an alert and notify the other two.',
    links: [
      ['Place a fraud alert with Equifax', 'https://www.equifax.com/personal/credit-report-services/credit-fraud-alerts'],
      ['FTC fraud alert guide', 'https://consumer.ftc.gov/articles/credit-freezes-and-fraud-alerts'],
    ],
  },
  {
    title: 'Identity monitoring and alerts', Icon: ScanFace,
    description: 'Review services that monitor for misuse of personal information.',
    links: [
      ['Experian IdentityWorks (paid)', EXPERIAN_IDENTITY],
      ['CFPB identity monitoring guide', 'https://www.consumerfinance.gov/ask-cfpb/what-is-identity-monitoring-or-identity-theft-service-en-1369/'],
    ],
  },
  {
    title: 'Identity theft coverage', Icon: ShieldCheck,
    description: 'Check policy limits, deductibles, and eligibility with your insurer or benefits provider.',
    links: [
      ['Review Experian coverage and eligibility', EXPERIAN_IDENTITY],
      ['FTC identity theft insurance guide', FTC_IDENTITY],
    ],
  },
  {
    title: 'Identity restoration support', Icon: HeartHandshake,
    description: 'Report identity theft to the FTC and get a recovery plan.',
    links: [['Start at IdentityTheft.gov', 'https://www.identitytheft.gov/']],
  },
];

function openProvider(event) {
  if (!isNativeRuntime()) return;
  event.preventDefault();
  void nativeExternalOpen(event.currentTarget.href).catch(() => reportNativeError('The provider page could not be opened. Please try again.'));
}

export default function VaultCreditTools() {
  return <section className="vault-panel vault-credit-tools" id="credit-and-identity" tabIndex={-1} aria-labelledby="vault-credit-heading">
    <h2 id="vault-credit-heading">Credit and identity protection</h2>
    <p>U.S. tools from credit bureaus, banks, and the FTC. Sign in and enter any financial information on the provider’s site.</p>
    <div className="vault-credit-grid">
      {CREDIT_TOOLS.map(({ title, Icon, description, links }) => <details className="vault-credit-option" key={title}>
        <summary>
          <Icon size={19} aria-hidden="true" />
          <span><strong>{title}</strong><span>{description}</span></span>
          <ChevronDown className="vault-credit-chevron" size={17} aria-hidden="true" />
        </summary>
        <ul>
          {links.map(([label, href]) => <li key={href}>
            <a className="vault-text-button" href={href} target="_blank" rel="noopener noreferrer" onClick={openProvider}>
              {label}<ExternalLink size={13} aria-hidden="true" />
            </a>
          </li>)}
        </ul>
      </details>)}
    </div>
  </section>;
}
