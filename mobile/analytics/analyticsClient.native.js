// A GA4 web measurement ID cannot initialize Firebase Analytics on iOS/Android.
// Keep collection unavailable until the linked Firebase native apps, platform
// configuration files, and a native consent-controlled SDK are configured.
// See ../ANALYTICS.md for the concrete native activation requirements.
export function createMobileAnalytics() {
  return {
    available: false,
    getConsent: () => 'unavailable',
    subscribe: () => () => {},
    setConsent: () => {},
    trackPage: () => {},
    dispose: () => {},
  };
}
