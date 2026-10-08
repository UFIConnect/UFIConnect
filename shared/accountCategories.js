// Plain JavaScript shared by the website and maintained React Native app.
export const ACCOUNT_CATEGORIES = [
  ['social', 'Social'], ['video', 'Video & Streaming'],
  ['work', 'Work & Development'], ['design', 'Design'],
  ['publishing', 'News & Publishing'], ['career', 'Career sites'],
  ['travel', 'Travel'], ['audio', 'Music & Audio'],
];

export function accountCategory(key, platform = {}, { business = false, careerSources = [] } = {}) {
  if ((business && key === 'linkedin') || platform.category === 'career' || careerSources.includes(key)) return 'career';
  if (['dribbble', 'behance', 'figma', 'pinterest'].includes(key)) return 'design';
  if (ACCOUNT_CATEGORIES.some(([category]) => category === platform.category)) return platform.category;
  if (['youtube', 'twitch', 'tiktok'].includes(key)) return 'video';
  if (['github', 'gitlab', 'linkedin', 'stackoverflow', 'producthunt'].includes(key)) return 'work';
  if (platform.category === 'publication' || ['medium', 'wordpress', 'tumblr', 'devto', 'hashnode', 'freecodecamp'].includes(key)) return 'publishing';
  return 'social';
}

export function accountSections(entries, options = {}) {
  return ACCOUNT_CATEGORIES.map(([id, label]) => {
    const items = entries.filter(([key, platform]) => accountCategory(key, platform, options) === id)
      .sort(([a, pa], [b, pb]) => String(pa.name || a).localeCompare(String(pb.name || b)));
    return { id, label, total: items.length, items };
  }).filter(section => section.total);
}

export function selectedAccountSections(sections, category) {
  const selected = sections.find(section => section.id === category);
  return selected ? [selected] : sections;
}
