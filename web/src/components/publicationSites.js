// Reader credentials stay with each publisher. These links open the
// publication's own account page; they are not UFIconnect OAuth connections.
export const PUBLICATION_SITES = [
  {
    key: 'wired',
    name: 'WIRED',
    color: '#111111',
    signInUrl: 'https://www.wired.com/account/profile',
    description: 'Manage your reader account, saved stories, and subscription.',
  },
  {
    key: 'mittr',
    name: 'MIT Technology Review',
    color: '#A31F34',
    signInUrl: 'https://www.technologyreview.com/login/',
    description: 'Sign in for saved stories, newsletters, and subscriber access.',
  },
  {
    key: 'smashing',
    name: 'Smashing Magazine',
    color: '#E9620A',
    signInUrl: 'https://www.smashingmagazine.com/auth/',
    description: 'Open your Smashing membership and community account.',
  },
  {
    key: 'infoq',
    name: 'InfoQ',
    color: '#67B346',
    signInUrl: 'https://www.infoq.com/social/keycloakLogin.action?fl=login',
    description: 'Follow topics, save articles, and access member resources.',
  },
  {
    key: 'theregister',
    name: 'The Register',
    color: '#CC0000',
    signInUrl: 'https://account.theregister.com/login/?r=https%3A%2F%2Fforums.theregister.com%2F',
    description: 'Manage your reader account and join article discussions.',
  },
  {
    key: 'arstechnica',
    name: 'Ars Technica',
    color: '#FF6600',
    signInUrl: 'https://arstechnica.com/civis/login/',
    description: 'Sign in to the Ars OpenForum and article discussions.',
  },
  {
    key: 'phoronix',
    name: 'Phoronix',
    color: '#2B7BB9',
    signInUrl: 'https://www.phoronix.com/forums/login',
    description: 'Open your forum account and manage Phoronix membership access.',
  },
  {
    key: 'devto',
    name: 'DEV Community',
    color: '#3B49DF',
    signInUrl: 'https://dev.to/enter',
    description: 'Sign in to read, save, discuss, and publish developer articles.',
  },
  {
    key: 'freecodecamp',
    name: 'freeCodeCamp',
    color: '#006400',
    signInUrl: 'https://www.freecodecamp.org/signin',
    description: 'Open your learning account and access saved article progress.',
  },
];
