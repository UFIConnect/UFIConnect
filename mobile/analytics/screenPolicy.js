// Only fixed screen names may leave the application. Never use route parameters,
// navigation titles, message contents, search text, profile data, or account IDs.
const SCREEN_PATHS = Object.freeze({
  Login: '/app/login',
  Register: '/app/register',
  Onboarding: '/app/onboarding',
  Opportunities: '/app/opportunities',
  Groups: '/app/groups',
  GroupDetail: '/app/group',
  Feed: '/app/feed',
  MessagesList: '/app/messages',
  Conversation: '/app/conversation',
  ProfileMain: '/app/profile',
  Security: '/app/security',
  Privacy: '/app/privacy',
});
// VPN use must not create optional analytics, first-party visit counts, or
// performance events. Keep exclusions explicit so new screens need a decision.
const EXCLUDED_SCREENS = Object.freeze(['VPN']);

function screenPath(name) {
  return typeof name === 'string' && Object.hasOwn(SCREEN_PATHS, name) ? SCREEN_PATHS[name] : null;
}

function createScreenTracker(controller) {
  return (name, navigationKey) => {
    const pathname = screenPath(name);
    // The navigation key is used only for in-memory visit deduplication by the
    // controller. The bridge receives only the fixed category and visit count.
    if (pathname) controller.trackPage(pathname, typeof navigationKey === 'string' ? navigationKey : pathname);
  };
}

module.exports = { SCREEN_PATHS, EXCLUDED_SCREENS, screenPath, createScreenTracker };
