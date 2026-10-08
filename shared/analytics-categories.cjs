'use strict';

// JSON is the browser/native import format. Backend's identical runtime copy
// lives inside Render's backend root; aggregate-analytics.test.js checks parity.
const catalog = require('./analytics-categories.json');
const PAGE_CATEGORIES = Object.freeze(Object.fromEntries(Object.entries(catalog)
  .map(([category, page]) => [category, Object.freeze(page)])));
const CATEGORY_IDS = Object.freeze(Object.keys(PAGE_CATEGORIES));
const EXCLUDED_CATEGORIES = Object.freeze([
  Object.freeze({ category: 'vault', label: 'Vault', platform: 'web', reason: 'Private Vault pages and activity are excluded.' }),
  Object.freeze({ category: 'vault_device', label: 'Vault devices', platform: 'web', reason: 'Private Vault device pages and activity are excluded.' }),
  Object.freeze({ category: 'app_vpn', label: 'VPN', platform: 'mobile', reason: 'VPN screens and connection activity are excluded.' }),
  Object.freeze({ category: 'auth_callback', label: 'Authorization callbacks', platform: 'web', reason: 'Credentials and authorization callback routes are excluded.' }),
]);

module.exports = { PAGE_CATEGORIES, CATEGORY_IDS, EXCLUDED_CATEGORIES };
