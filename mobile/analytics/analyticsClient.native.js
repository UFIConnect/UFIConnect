// Native VPN builds do not initialize or send data to third-party analytics.
// Keep this adapter inactive even if a web measurement ID is configured.
// VPN screens are also excluded from the separate first-party service metrics.
export function createMobileAnalytics() {
  return {
    available: false,
    getConsent: () => 'unavailable',
    getPersistenceError: () => null,
    subscribe: () => () => {},
    setConsent: () => {},
    trackPage: () => {},
    dispose: () => {},
  };
}
