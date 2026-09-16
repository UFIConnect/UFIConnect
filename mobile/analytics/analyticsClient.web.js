import { createAnalyticsController } from './generated/googleAnalytics.mjs';

export function createMobileAnalytics() {
  try {
    const controller = createAnalyticsController({
      window,
      document,
      bridgeUrl: process.env.EXPO_PUBLIC_ANALYTICS_BRIDGE_URL || 'https://api.uficonnect.org/analytics-bridge.html',
    });
    return { ...controller, available: true };
  } catch {
    // Invalid analytics host configuration must disable analytics, never stop
    // members from accessing their account or weaken the origin isolation.
    return {
      available: false,
      getConsent: () => 'unavailable',
      subscribe: () => () => {},
      setConsent: () => {},
      trackPage: () => {},
      dispose: () => {},
    };
  }
}
