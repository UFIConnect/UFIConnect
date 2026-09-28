// Google Ads text assets for UFIconnect. `node scripts/generate-google-ads.mjs`
// validates every string against Google's limits and writes the Editor CSVs.
// Claims must stay true to the public site: free core features, no ads in the
// feed, 80+ communities, 30+ live sources and browsing without an account are
// all stated on https://uficonnect.org/. Keep third-party names out of ad text.

export const businessName = 'UFIconnect';
export const siteUrl = 'https://uficonnect.org/';

// Shared headlines appear in every responsive search ad alongside the ad
// group's own headlines (15 in total per ad).
const sharedHeadlines = [
  'UFIconnect',
  'Join UFIconnect Free',
  'An Ad-Free Social Network',
  'No Ads in Your Feed',
  'Free to Join',
  'Browse Without Signing Up',
  'Explore 80+ Communities',
  '30+ Live Sources, One Feed',
];

const sharedDescriptions = [
  'Meet people who share your interests, join communities and find your next opportunity.',
  'Explore the public feed before you join, then personalize it around what you care about.',
];

export const searchCampaign = {
  name: 'UFIconnect | Search | Sign-ups',
  budget: '10.00',
  bidStrategy: 'Maximize clicks',
  languages: 'en',
  // Existing members looking for the sign-in page are not new sign-ups.
  negativeKeywords: ['login', 'log in', 'sign in', 'apk', 'hack'],
  adGroups: [
    {
      name: 'Brand',
      finalUrl: siteUrl,
      path: ['join-free', ''],
      keywords: [['uficonnect', 'Exact'], ['uficonnect', 'Phrase'], ['ufi connect', 'Phrase']],
      headlines: [
        'UFIconnect Official Site',
        'Sign Up for UFIconnect',
        'Your World, Connected',
        'Your Interests. Your People.',
        'Explore the Public Feed',
        'Find People, Groups and Jobs',
        'Start Free, Grow From There',
      ],
      descriptions: [
        'Your interests, your communities, your people. Create your free UFIconnect account.',
        'Posts, communities, messaging and jobs in one place, with no ads in your feed.',
      ],
    },
    {
      name: 'Ad-free social network',
      finalUrl: siteUrl,
      path: ['social-network', 'ad-free'],
      keywords: [
        ['ad free social network', 'Exact'], ['social network without ads', 'Phrase'],
        ['social media without ads', 'Phrase'], ['new social network', 'Phrase'],
        ['interest based social network', 'Phrase'],
      ],
      headlines: [
        'A Social Network Without Ads',
        'Your Interests, One Feed',
        'Find Your Kind of People',
        'Good Conversations Start Here',
        'Build a Feed Around You',
        'Meet People, Share Ideas',
        'Posts, Groups and Messages',
      ],
      descriptions: [
        'Bring conversations from 30+ live sources together and balance the mix your way.',
        'Posts, communities, messaging and jobs in one place, with no ads in your feed.',
      ],
    },
    {
      name: 'Communities',
      finalUrl: siteUrl,
      path: ['communities', 'join-free'],
      keywords: [
        ['online communities', 'Phrase'], ['join an online community', 'Phrase'],
        ['find people with similar interests', 'Phrase'], ['meet people with shared interests', 'Phrase'],
        ['interest based communities', 'Phrase'],
      ],
      headlines: [
        'Find Your Kind of People',
        'Join Communities You Love',
        'Design, Tech, Music and More',
        'Meet People Like You',
        'Start or Join a Group',
        'Communities for Your Interests',
        'Good Conversations Start Here',
      ],
      descriptions: [
        'Explore 80+ communities for design, tech, music, careers and more. Join free today.',
        'Start a group for your interests or join one that already feels like home.',
      ],
    },
    {
      name: 'Jobs and opportunities',
      finalUrl: `${siteUrl}search`,
      path: ['jobs', 'opportunities'],
      keywords: [
        ['networking app for jobs', 'Phrase'], ['professional networking app', 'Phrase'],
        ['job search social network', 'Phrase'], ['find remote jobs', 'Phrase'],
        ['find gigs online', 'Phrase'],
      ],
      headlines: [
        'Jobs, Gigs and Opportunities',
        'Make Room for Your Next Move',
        'Find Your Next Opportunity',
        'Network and Job Hunt in One',
        'Remote and Local Jobs',
        'Save Jobs and Come Back Later',
        'Learning Opportunities Too',
      ],
      descriptions: [
        'Find jobs, gigs and learning opportunities that match what you enjoy. Join free today.',
        'Meet people in your field, join career communities and save the roles you like.',
      ],
    },
  ].map(group => ({
    ...group,
    headlines: [...sharedHeadlines, ...group.headlines],
    descriptions: [...group.descriptions, ...sharedDescriptions],
  })),
  sitelinks: [
    { text: 'Explore the Public Feed', lines: ['Browse posts before you join', 'No account needed to look around'], url: `${siteUrl}global` },
    { text: 'Join Free', lines: ['Create your free account', 'Personalize your feed and groups'], url: `${siteUrl}register` },
    { text: 'Find People and Jobs', lines: ['Search posts, people and groups', 'Discover job opportunities'], url: `${siteUrl}search` },
    { text: 'Our Privacy Approach', lines: ['We never sell your personal data', 'Clear choices for analytics'], url: `${siteUrl}privacy` },
  ],
  callouts: [
    'Free to Join', 'No Ads in Your Feed', '80+ Communities', '30+ Live Sources',
    'Browse Without Sign-Up', 'Direct Messaging', 'Optional Pro Plans',
  ],
  structuredSnippet: { header: 'Types', values: ['Communities', 'Jobs', 'Gigs', 'Videos', 'Messaging'] },
};

// Responsive display ads, Demand Gen and Performance Max asset groups all use
// this text with the images in marketing/google-ads/images.
export const displayAssets = {
  finalUrl: siteUrl,
  callToAction: 'Sign up',
  headlines: [
    'Find Your Kind of People',
    'An Ad-Free Social Network',
    'Explore 80+ Communities',
    'Jobs, Gigs and Opportunities',
    'Join UFIconnect Free',
  ],
  longHeadlines: [
    'Meet people, join communities and find your next opportunity on UFIconnect',
    'A social network for your interests, your communities and your next move',
    'Explore 80+ communities and 30+ live sources in one feed with no ads',
  ],
  descriptions: [
    'Free to join. No ads in your feed.',
    'Meet people who share your interests, join communities and find your next opportunity.',
    'Explore the public feed before you join, then personalize it around what you care about.',
    'Find jobs, gigs and learning opportunities that match what you enjoy. Join free today.',
    'Explore 80+ communities for design, tech, music, careers and more. Join free today.',
  ],
};

// Google's published limits. Descriptions for display need one of 60 or fewer.
export const limits = {
  headline: 30, longHeadline: 90, description: 90, shortDescription: 60, path: 15,
  businessName: 25, sitelinkText: 25, sitelinkLine: 35, callout: 25, snippetValue: 25,
  searchHeadlines: [3, 15], searchDescriptions: [2, 4], displayHeadlines: [1, 5],
  displayLongHeadlines: [1, 5], displayDescriptions: [1, 5],
};

// Every image Google accepts for responsive display, Demand Gen and
// Performance Max: 1.91:1 landscape, 1:1 square and 4:5 portrait marketing
// images, plus 1:1 and 4:1 logos. Each file must stay under 5,120 KB.
export const imageSizes = {
  landscape: [1200, 628],
  square: [1200, 1200],
  portrait: [960, 1200],
  'logo-square': [1200, 1200],
  'logo-landscape': [1200, 300],
};
export const maxImageBytes = 5120 * 1024;
