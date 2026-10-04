import { createAdsController } from './googleAds.mjs';
let controller;
const disabled = Object.freeze({ available: false, getConsent: () => 'denied', getPrivacySignal: () => false,
  getPersistenceError: () => null, subscribe: () => () => {}, setConsent() {}, setHomepageEligible() {}, mustLeave: () => false });
export function getGoogleAds() {
  if (typeof window === 'undefined') return disabled;
  if (!controller) {
    try { controller = createAdsController({ window, document }); } catch { controller = disabled; }
  }
  return controller;
}
