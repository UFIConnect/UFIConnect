import { HOME_FEED_SOURCE_IDS, SOURCE_META } from '../components/sourceMeta';

export const CITY_SOURCE_PRESETS = {
  community: ['uficonnect', 'reddit', 'bluesky', 'mastodon', 'facebook'],
  technology: ['github', 'gitlab', 'hackernews', 'devto', 'stackoverflow', 'phoronix'],
  science: ['arxiv', 'mittr', 'wired', 'hackernews', 'reddit'],
  writing: ['medium', 'wordpress', 'reddit', 'bluesky', 'uficonnect'],
  travel: ['wikivoyage', 'travelnews', 'travelevents', 'livecamera', 'localpulse', 'reddit'],
  restaurants: ['restaurants', 'localpulse', 'reddit', 'youtube', 'uficonnect'],
  nightlife: ['bars', 'travelevents', 'localpulse', 'reddit', 'uficonnect'],
  cooking: ['youtube', 'reddit', 'medium', 'uficonnect'],
  music: ['youtube', 'reddit', 'bluesky', 'uficonnect'],
  video: ['youtube', 'reddit', 'mastodon', 'bluesky'],
  sports: ['reddit', 'youtube', 'bluesky', 'uficonnect'],
  gaming: ['youtube', 'reddit', 'github', 'bluesky'],
  business: ['producthunt', 'techcrunch', 'indiehackers', 'yc', 'crunchbase', 'venturebeat'],
  design: ['behance', 'designweb', 'smashing', 'dribbble', 'reddit', 'youtube'],
  careers: ['indeed', 'remoteok', 'remotive', 'muse', 'usajobs', 'uficonnect'],
  people: ['uficonnect', 'github', 'bluesky', 'reddit', 'mastodon'],
};
export const CITY_SOURCE_IDS = [...new Set(['uficonnect', ...HOME_FEED_SOURCE_IDS, ...Object.values(CITY_SOURCE_PRESETS).flat()])]
  .filter(source => SOURCE_META[source]);
const CATEGORY_TOPICS = {
  community: ['Community', 'Networking', 'Volunteering', 'Personal Growth'],
  technology: ['Technology', 'AI & Machine Learning', 'Web Development', 'Open Source', 'Cybersecurity'],
  science: ['Science', 'Research', 'Space', 'Climate', 'Biology'],
  writing: ['Writing', 'Journalism', 'Books', 'Storytelling', 'Content Creation'],
  travel: ['Travel', 'Adventure', 'Culture', 'Nature', 'Local Events'],
  restaurants: ['Restaurant Culture', 'Italian', 'Japanese', 'Mexican', 'Indian', 'Mediterranean'],
  nightlife: ['Nightlife', 'Live Music', 'Jazz', 'Cocktails', 'Dance'],
  cooking: ['Cooking', 'Recipes', 'Baking', 'Nutrition', 'Plant Based'],
  music: ['Music', 'Pop', 'Hip-Hop', 'Jazz', 'Classical', 'Electronic'],
  video: ['Video', 'Film', 'Documentaries', 'Animation', 'Education'],
  sports: ['Sports', 'Football', 'Basketball', 'Soccer', 'Tennis', 'Fitness'],
  gaming: ['Gaming', 'Game Development', 'Esports', 'Indie Games'],
  business: ['Business', 'Startups', 'Entrepreneurship', 'Marketing', 'Leadership'],
  design: ['Design', 'UX/UI', 'Graphic Design', 'Architecture', 'Photography'],
  careers: ['Careers', 'Remote Work', 'Career Growth', 'Interview Preparation', 'Leadership'],
  people: ['Community', 'Networking', 'Collaboration', 'Mentorship'],
};
const SOURCE_TOPICS = {
  github: ['Open Source', 'Web Development', 'AI & Machine Learning'],
  gitlab: ['Open Source', 'DevOps', 'Web Development'],
  arxiv: ['Research', 'AI & Machine Learning', 'Physics'],
  youtube: ['Video', 'Education', 'Music'],
  stackoverflow: ['Programming', 'Web Development', 'Databases'],
  devto: ['Web Development', 'Open Source', 'Career Growth'],
  medium: ['Writing', 'Technology', 'Personal Growth'],
};
export function houseTopics(category, source) {
  return [...new Set([...(CATEGORY_TOPICS[category] || []), ...(SOURCE_TOPICS[source] || [])])];
}
export const CITY_ALL_TOPICS = [...new Set([...Object.values(CATEGORY_TOPICS).flat(), ...Object.values(SOURCE_TOPICS).flat()])].sort();
