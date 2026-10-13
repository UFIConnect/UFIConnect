'use strict';

const APP_ORIGIN = 'https://app.uficonnect.org';

// Capture only the browser's exact trusted app Origin at the start of a flow.
// Callers seal this value into OAuth state; callback parameters never select it.
function createOAuthFrontend({ frontendBase, allowedOrigins } = {}) {
  const origins = typeof allowedOrigins === 'string' ? allowedOrigins.split(',').map(value => value.trim()) : [];
  const appAllowed = origins.includes(APP_ORIGIN);
  return {
    capture(req) { return appAllowed && req?.headers?.origin === APP_ORIGIN ? { returnOrigin: APP_ORIGIN } : {}; },
    resolve(value) { return appAllowed && value === APP_ORIGIN ? APP_ORIGIN : frontendBase; },
  };
}

module.exports = { APP_ORIGIN, createOAuthFrontend };
