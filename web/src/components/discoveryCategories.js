export const DISCOVERY_CATEGORIES = {
  restaurants: {
    label: 'Restaurants', filterLabel: 'Cuisines',
    choices: [['italian', 'Italian'], ['japanese', 'Japanese'], ['chinese', 'Chinese'], ['mexican', 'Mexican'], ['indian', 'Indian'], ['thai', 'Thai'], ['mediterranean', 'Mediterranean'], ['french', 'French'], ['american', 'American'], ['vegan', 'Vegan']],
  },
  bars: {
    label: 'Bars and clubs', filterLabel: 'Bar and club themes',
    choices: [['cocktail', 'Cocktails'], ['rooftop', 'Rooftops'], ['wine', 'Wine'], ['beer', 'Craft beer'], ['music', 'Live music'], ['sports', 'Sports'], ['jazz', 'Jazz'], ['beach', 'Beach'], ['club', 'Clubs']],
  },
  countries: {
    label: 'Travel', filterLabel: 'Travel events',
    choices: [['festival', 'Festivals'], ['concert', 'Concerts'], ['food', 'Food events'], ['art', 'Art and culture'], ['sport', 'Sports'], ['market', 'Markets'], ['outdoor', 'Outdoors']],
  },
};

export function discoveryChoice(mode, filters = {}) {
  return DISCOVERY_CATEGORIES[mode]?.choices.find(([key]) => key === filters.discovery?.[mode]) || null;
}

// Keep cuisine/theme/event choices independent of the member's manual search
// and topic choices. The server filters its complete pool before equalizing
// and paginating it, so a choice never filters only the first loaded page.
export function discoveryQuery(mode, filters, search = '') {
  return [String(search || '').trim(), discoveryChoice(mode, filters)?.[0]].filter(Boolean).join(' ');
}

export function discoveryPostContext(mode, posts = []) {
  const category = DISCOVERY_CATEGORIES[mode];
  if (!category) return null;
  const sources = new Map();
  for (const post of posts) {
    try {
      const url = new URL(post.sourceUrl || post.group?.externalUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      const host = url.hostname.replace(/^www\./, '');
      const platform = ['youtube.com', 'youtu.be'].includes(host) ? 'youtube'
        : host === 'reddit.com' || host.endsWith('.reddit.com') ? 'reddit'
        : String(post.source || '').slice(0, 50);
      const key = `${platform}:${url.hostname}`;
      if (!sources.has(key)) sources.set(key, {
        platform,
        label: String(post.author?.name || post.sourceLabel || url.hostname).slice(0, 100),
        url: url.href,
      });
    } catch {}
  }
  return { mode, label: category.label, sources: [...sources.values()].slice(0, 24) };
}
