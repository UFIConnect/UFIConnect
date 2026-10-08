import { useEffect, useState } from 'react';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import defaultAvatar from '../assets/snap-profile-default.svg';

export function snapAvatarUrls(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).flatMap(value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return [];
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port ? [url.href] : [];
    } catch { return []; }
  }))];
}

// Photos belong to the same author; unavailable images use a local profile
// placeholder rather than the snap's media or an unrelated person's photo.
export default function SnapAvatar({ urls, source = 'uficonnect', member = false, badge = false, className = 'snap-profile-avatar', refreshKey = 0 }) {
  const candidates = snapAvatarUrls(urls), key = candidates.join('\n');
  const [failed, setFailed] = useState([]);
  useEffect(() => setFailed([]), [key, refreshKey]);
  const src = candidates.find(url => !failed.includes(url)) || defaultAvatar;
  const meta = SOURCE_META[source] || SOURCE_META.uficonnect;
  return <span className={className} style={{ '--source-color': member ? 'var(--primary)' : meta.color }} aria-hidden="true">
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" data-snap-avatar={src === defaultAvatar ? 'default' : 'profile'}
      onError={() => { if (src !== defaultAvatar) setFailed(current => current.includes(src) ? current : [...current, src]); }} />
    {badge && !member && <span className="post-chrome-badge" style={{ '--source-color': meta.color }}>
      {hasBrandIcon(source) ? <BrandIcon platform={source} size={13} /> : <b>{meta.icon}</b>}
    </span>}
  </span>;
}
