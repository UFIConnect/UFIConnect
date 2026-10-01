import { useEffect, useState } from 'react';

export const CENTERS = [
  { id: 'sports', label: 'Sports center', description: 'Follow your teams and organize your match calendar.', topic: 'Sports' },
  { id: 'gym', label: 'Gym', description: 'Keep workout plans and notes, and explore fitness posts and groups.', topic: 'Fitness' },
  { id: 'yoga', label: 'Yoga', description: 'Save practice notes and discover yoga posts and groups.', topic: 'Yoga' },
  { id: 'cooking', label: 'Cooking center', description: 'Save recipes, plan meals, and scale ingredient quantities.', topic: 'Cooking' },
  { id: 'hikes', label: 'Hikes', description: 'Plan hikes, keep trail notes, and explore hiking posts and groups.', topic: 'Hiking' },
  { id: 'dating', label: 'Dating', description: 'Keep personal notes and explore dating conversations and groups.', topic: 'Dating' },
  { id: 'monetization', label: 'Monetization', description: 'Plan source revenue, track reported earnings, and compare monetization ideas.', topic: 'Business' },
  { id: 'deep-learning', label: 'Deep learning', description: 'Prepare source datasets and model experiments with clear training and evaluation plans.', topic: 'AI & Machine Learning' },
  { id: 'source-analytics', label: 'Analytics', route: '/analytics', description: 'View UFI activity, authorized source analytics, and your imported reports.', topic: 'Technology' },
  { id: 'writing', label: 'Article writing', description: 'Draft an article, then review it in the UFI composer.', topic: 'Writing' },
  { id: 'research', label: 'Research center', description: 'Keep sources and notes together in a research notebook.', topic: 'Science' },
  { id: 'developer', label: 'Developer', description: 'Write a frontend prototype and preview it in a sandbox.', topic: 'Technology' },
  { id: 'developer-analytics', label: 'Developer analytics', description: 'See activity from your local workspaces.', topic: 'Technology' },
  { id: 'backend', label: 'Backend developer', description: 'Design request examples and validate JSON payloads.', topic: 'Technology' },
];
export const CITY_CATEGORIES = [
  { id: 'community', label: 'Community', topic: 'Community', color: '#4f8cff', route: '/?feed=ufi' },
  { id: 'technology', label: 'Technology', topic: 'Technology', color: '#5983be' },
  { id: 'science', label: 'Science', topic: 'Science', color: '#6b9cb2' },
  { id: 'writing', label: 'Writing', topic: 'Writing', color: '#a789c4', route: '/centers/writing' },
  { id: 'travel', label: 'Travel', topic: 'Travel', color: '#47a6a3', mode: 'countries', route: '/?feed=countries' },
  { id: 'restaurants', label: 'Restaurants', topic: 'Restaurant Culture', color: '#c79367', mode: 'restaurants', route: '/?feed=restaurants' },
  { id: 'nightlife', label: 'Bars & clubs', topic: 'Nightlife', color: '#8873b6', mode: 'bars', route: '/?feed=bars' },
  { id: 'cooking', label: 'Cooking', topic: 'Cooking', color: '#92a461', route: '/centers/cooking' },
  { id: 'music', label: 'Music', topic: 'Music', color: '#bc789e', route: '/music' },
  { id: 'video', label: 'Video', topic: 'Video', color: '#cc7774', route: '/videos' },
  { id: 'sports', label: 'Sports', topic: 'Sports', color: '#62a27b', route: '/centers/sports' },
  { id: 'gaming', label: 'Gaming', topic: 'Gaming', color: '#8d83c6' },
  { id: 'business', label: 'Business', topic: 'Business', color: '#ac975e' },
  { id: 'design', label: 'Design', topic: 'Design', color: '#be888b' },
  { id: 'careers', label: 'Careers', topic: 'Careers', color: '#6a97ad', route: '/opportunities' },
  { id: 'people', label: 'People', topic: 'Community', color: '#678ed0', route: '/people' },
];
export function workspaceKey(accountId, section) {
  return 'ufi:local-workspace:' + encodeURIComponent(accountId) + ':' + section;
}
export function readWorkspace(accountId, section, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(workspaceKey(accountId, section)));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch { return fallback; }
}
export function useLocalWorkspace(accountId, section, fallback) {
  const key = workspaceKey(accountId, section);
  const [entry, setEntry] = useState(() => ({ key, value: readWorkspace(accountId, section, fallback) }));
  const [error, setError] = useState('');
  useEffect(() => { setEntry({ key, value: readWorkspace(accountId, section, fallback) }); setError(''); }, [key]);
  const value = entry.key === key ? entry.value : fallback;
  function save(next) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setEntry({ key, value: next }); setError('');
      return true;
    } catch { setError('This browser could not save your changes. Free some storage or download a copy before leaving.'); return false; }
  }
  return { value, save, error };
}
export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
