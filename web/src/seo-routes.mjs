// Public HTML is rendered from the same components visitors use. Member data
// is never fetched or embedded during a build.
export const publicRoutes = [
  { path: '/', page: 'landing', title: 'UFIconnect | People, communities and opportunities', description: 'Explore public posts, meet people with shared interests, join communities, and discover job opportunities on UFIconnect.', index: true },
  { path: '/global', page: 'global', title: 'Explore the public feed | UFIconnect', description: 'Browse public posts from UFIconnect and a range of sources. Explore ideas and conversations before creating an account.', index: true },
  { path: '/register', page: 'register', title: 'Create your account | UFIconnect', description: 'Create a UFIconnect account to personalize your feed, join communities, connect with people, and explore opportunities.', index: true },
  { path: '/login', page: 'login', title: 'Sign in | UFIconnect', description: 'Sign in to UFIconnect with your account email and password. Get password-reset help or explore the public feed.', index: false },
  { path: '/search', page: 'search', title: 'Find posts, people, groups and jobs | UFIconnect', description: 'Learn how to search UFIconnect for posts, people, groups and job opportunities. Browse the public feed or sign in to use search filters.', index: true },
  { path: '/privacy', page: 'privacy', title: 'Privacy policy | UFIconnect', description: 'Read how UFIconnect handles account information, activity data, connected accounts, analytics choices, and privacy requests.', index: true },
  { path: '/terms', page: 'terms', title: 'Terms of service | UFIconnect', description: 'Read the terms for using UFIconnect, including account responsibilities, acceptable use, content, and subscriptions.', index: true },
  { path: '/child-safety', page: 'childSafety', title: 'Child safety standards | UFIconnect', description: 'Learn about UFIconnect child safety standards, prohibited content, and how to report a safety concern.', index: true },
  { path: '/forgot-password', page: 'forgotPassword', title: 'Reset your password | UFIconnect', description: 'Request a password-reset link for your UFIconnect account and learn how to return to sign-in.', index: false },
];
export const memberRoutes = ['/analytics','/vault','/people','/reset-password','/onboarding','/videos','/you','/music','/groups','/groups/post','/opportunities','/resume-builder','/resume-builder/cover-letter/preview','/messages','/notifications','/profile','/command-center','/connected-accounts','/post','/settings','/sources','/saved/posts','/saved/jobs'];
export const dynamicRoutes = ['/groups/:id','/opportunities/:id','/messages/:userId','/p/:id','/u/:id'];
export const redirectRoutes = [{ source:'/global-scroll', destination:'/global' },{ source:'/hq', destination:'/command-center' },{ source:'/agents', destination:'/command-center' }];
