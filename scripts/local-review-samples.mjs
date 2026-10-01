import preparationDurations from '../web/src/data/preparationDurations.js';

const clips = Object.entries(preparationDurations).map(([slug, duration]) => ({ slug,
  seconds: duration.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0) }));
const feedSources = ['reddit', 'hackernews', 'github', 'mastodon'];
const videoSources = ['reddit', 'github', 'mastodon'];
const jobSources = ['Remotive', 'Arbeitnow', 'Remote OK'];
const themes = {
  feed: ['Open source projects bring communities together', 'A better workspace for designers and builders', 'AI tools for creative teams', 'Share your music and meet collaborators', 'Travel ideas from your community', 'Local restaurants worth discovering'],
  following: ['Your community is building something new', 'A local member shares their creative process', 'A conversation about open source collaboration'],
  groups: ['Builders circle weekly discussion', 'Meet the community and share your goals', 'Design circle project ideas'],
  restaurants: ['Italian restaurant evening downtown', 'Japanese restaurant tasting menu', 'Mexican restaurant community favorites', 'Mediterranean restaurant lunch', 'Indian restaurant weekend menu', 'French restaurant neighborhood dinner'],
  bars: ['Rooftop bars with city views', 'Jazz clubs and live music', 'Wine bars and tasting nights', 'Cocktail bars for a relaxed evening', 'Dance clubs and weekend DJs', 'Sports bars for match night'],
  countries: ['San Diego travel guide and local events', 'Tokyo travel festival weekend', 'London travel concerts and exhibitions', 'Paris travel food festival', 'New York travel live music events', 'Barcelona travel city walks'],
};
const titles = ['Community engineer', 'Product designer', 'Frontend engineer', 'Music community coordinator', 'Travel partnerships manager', 'Restaurant platform developer'];
const split = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const number = (value, fallback, maximum = 10000) => Number.isFinite(Number(value)) && value !== null ? Math.min(maximum, Math.max(0, Math.trunc(Number(value)))) : fallback;
const matches = (value, query) => !query || query.toLowerCase().split(/\s+/).filter(Boolean).every(term => value.toLowerCase().includes(term));

// This fixture is mounted only by the explicitly requested local launcher.
// Its content is synthetic, external actions are not advertised as available,
// and playable video is restricted to existing files shipped in this repo.
export function createLocalReviewSamples() {
  const generations = new Map();
  const refreshes = new Map();
  const feedSeeds = new Map();
  function feed(url, origin) {
    const p = url.searchParams;
    const video = /\/office\/feed\/(videos|music)/.test(url.pathname);
    const music = url.pathname.includes('/music');
    const mode = p.get('mode') || (video ? (music ? 'music' : 'videos') : 'feed');
    const key = video ? (music ? 'music' : 'videos') : mode;
    const cursor = /^(\d+):(\d+)$/.exec(p.get('cursor') || '');
    const limit = Math.max(1, number(p.get('limit'), video ? 10 : 25, 40));
    const offset = cursor ? number(cursor[2], 0) : Math.max(0, number(p.get('page'), 1) - 1) * limit;
    let generation = Number(cursor?.[1]) || generations.get(key) || 1;
    const seedKey = !video && p.get('seed') ? `${key}:${p.get('seed')}` : null;
    if (!cursor && seedKey) {
      if (feedSeeds.has(seedKey)) generation = feedSeeds.get(seedKey);
      else {
        // Main Feed refresh rotates its seed even when provider busting is
        // intentionally off. Retain that batch for repeated reads/pagination.
        if (offset === 0) { generation++; generations.set(key, generation); }
        feedSeeds.set(seedKey, generation);
        while (feedSeeds.size > 100) feedSeeds.delete(feedSeeds.keys().next().value);
      }
    } else if (p.get('bust') === '1' && !cursor && offset === 0) {
      generation++; generations.set(key, generation);
    }
    const requested = split(p.get('sources') || p.get('source'));
    const defaults = video ? videoSources : mode === 'groups' || mode === 'following' ? ['uficonnect'] : feedSources;
    // Bluesky video URLs require a provider HLS playlist, not our local MP4s.
    const sources = (requested.length ? requested : defaults).filter(source => !video || source !== 'bluesky');
    const topics = split(p.get('topics'));
    const texts = themes[mode] || themes.feed;
    const rows = sources.length ? Array.from({ length: video ? 160 : 520 }, (_, index) => {
      const source = sources[index % sources.length];
      const clip = clips[index % clips.length];
      const topic = topics[index % topics.length] || (mode === 'restaurants' ? 'Restaurant Culture' : mode === 'bars' ? 'Nightlife' : mode === 'countries' ? 'Travel' : 'Technology');
      const localClip = new URL(`/media/preparation/${clip.slug}.mp4`, origin).href;
      const title = video ? `Sample ${music ? 'Music layout' : 'Video'} · ${clip.slug.replaceAll('-', ' ')} · ${generation}-${index + 1}`
        : `Sample · ${texts[index % texts.length]} · ${generation}-${index + 1}`;
      return { id: `local-sample-${key}-${topic}-${generation}-${index}`, source, title, topic,
        content: `Local preview sample only; this is not a live ${source} post. ${texts[index % texts.length]}. ${music && p.get('genre') ? `Selected genre: ${p.get('genre')}. ` : ''}${video ? 'This built-in preparation clip is reused solely to review playback and scrolling.' : 'Scroll to load more samples, or return to the top to refresh with a new sample batch.'}`,
        createdAt: new Date(Date.now() - index * 60000).toISOString(), author: { id: 'local-sample-author', name: 'Local sample community' },
        sourceUrl: video ? localClip : new URL('/?feed=feed', origin).href,
        isExternal: false, likes: [], comments: [], ...(mode === 'groups' ? { groupId: 'local-review-builders' } : {}),
        ...(video ? { mediaType: 'video', mediaUrl: localClip, videoDurationSeconds: clip.seconds } : {}) };
    }).filter(post => matches(`${post.title} ${post.content} ${post.topic}`, p.get('q'))) : [];
    const posts = rows.slice(offset, offset + limit);
    return { posts, mode, hasMore: offset + limit < rows.length, waitingForNew: offset + limit >= rows.length,
      cursor: offset + limit < rows.length ? `${generation}:${offset + limit}` : null,
      nativeUficonnectIncluded: true, sourceErrors: {}, liveFeeds: [], sampleContent: true };
  }
  function jobs(url, origin) {
    const p = url.searchParams;
    const refresh = p.get('refresh') || '';
    if (refresh && !refreshes.has(refresh)) {
      refreshes.set(refresh, (generations.get('jobs') || 1) + 1);
      generations.set('jobs', refreshes.get(refresh));
      while (refreshes.size > 50) refreshes.delete(refreshes.keys().next().value);
    }
    const generation = refresh ? refreshes.get(refresh) : 1;
    const sources = split(p.get('sources'));
    const exclude = new Set(split(p.get('exclude')));
    const rows = Array.from({ length: 160 }, (_, index) => {
      const source = (sources.length ? sources : jobSources)[index % (sources.length || jobSources.length)];
      return { id: `local-sample-job-${generation}-${index}`, title: `Sample · ${titles[index % titles.length]} · ${generation}-${index + 1}`,
        org: 'Local preview company — not a real vacancy', source,
        sourceUrl: new URL('/opportunities?sample=1', origin).href,
        content: 'Synthetic local review listing. Use search, filters, infinite scrolling, and scroll-to-refresh here. No application will be sent.',
        description: 'This is sample content for reviewing the jobs experience, not an open position.',
        type: 'job', location: index % 2 ? 'Remote' : 'San Diego', remote: index % 2 === 1,
        posted: new Date(Date.now() - index * 60000).toISOString(), isLive: false, tags: ['Sample', 'Local review'] };
    }).filter(job => !exclude.has(job.id) && matches(`${job.title} ${job.org} ${job.content}`, p.get('search'))
      && (!p.has('remote') || job.remote === (p.get('remote') === 'true'))
      && (!p.get('type') || p.get('type') === 'job') && p.get('live') !== 'true');
    const offset = number(p.get('offset'), 0), limit = Math.max(1, number(p.get('limit'), 20, 40));
    return { opportunities: rows.slice(offset, offset + limit), hasMore: offset + limit < rows.length,
      totalCount: rows.length, availableSources: [...new Set([...jobSources, ...sources])], refreshMode: refresh ? 'unseen' : null, sampleContent: true };
  }
  return {
    read(url, origin) {
      if (/^\/api\/office\/feed(?:\/(?:videos|music)(?:\/following)?)?$/.test(url.pathname)) return feed(url, origin);
      if (url.pathname === '/api/opportunities') return jobs(url, origin);
      return null;
    },
  };
}
