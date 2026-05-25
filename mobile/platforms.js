// Platform visual config — kept on the client so we don't need an extra fetch
export const PLATFORM_META = {
  facebook: {
    name: 'Facebook',
    emoji: '🔵',
    color: '#1877F2',
    bg: '#E7F0FF',
    description: 'See posts and discussions from your Facebook Groups.',
  },
  instagram: {
    name: 'Instagram',
    emoji: '📸',
    color: '#E1306C',
    bg: '#FDE8F0',
    description: 'Import your posts and follow industry creators.',
  },
  linkedin: {
    name: 'LinkedIn',
    emoji: '💼',
    color: '#0A66C2',
    bg: '#E8F1FB',
    description: 'Import your professional profile and network activity.',
  },
  twitter: {
    name: 'X (Twitter)',
    emoji: '✖️',
    color: '#000000',
    bg: '#F0F0F0',
    description: 'Follow hashtags and conversations in your fields.',
  },
  reddit: {
    name: 'Reddit',
    emoji: '🟠',
    color: '#FF4500',
    bg: '#FEF0EA',
    description: 'Pull posts from subreddits matching your interests.',
  },
  indeed: {
    name: 'Indeed',
    emoji: '💼',
    color: '#003A9B',
    bg: '#E6ECF8',
    description: 'Get job recommendations matched to your profile.',
  },
};

export const PLATFORM_ORDER = ['facebook', 'instagram', 'linkedin', 'twitter', 'reddit', 'indeed'];
