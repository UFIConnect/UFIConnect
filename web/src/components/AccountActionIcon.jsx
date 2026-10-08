import { LogIn } from 'lucide-react';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import './AccountActionIcon.css';

export default function AccountActionIcon({ platform, busy = false }) {
  if (busy) return <span className="spinner account-action-spinner" aria-hidden="true" />;
  return <span className="account-action-icon" aria-hidden="true">
    {hasBrandIcon(platform) ? <BrandIcon platform={platform} size={22} /> : <LogIn size={22} />}
  </span>;
}
