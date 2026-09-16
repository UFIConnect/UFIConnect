import { createAnalyticsController } from './googleAnalytics.mjs';

let controller;
export function getGoogleAnalytics() {
  if (!controller && typeof window !== 'undefined') {
    try { controller = createAnalyticsController({
      window, document, bridgeUrl: import.meta.env.VITE_ANALYTICS_BRIDGE_URL || 'https://api.uficonnect.org/analytics-bridge.html',
    }); } catch {
      // A deployment configuration error must disable optional collection,
      // never prevent someone signing in or changing their security settings.
      controller = Object.freeze({ available: false, getConsent: () => 'denied', subscribe: () => () => {},
        setConsent() {}, trackPage() {} });
    }
  }
  return controller;
}
