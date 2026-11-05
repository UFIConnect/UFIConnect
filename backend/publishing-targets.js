'use strict';

const { createAccountPublishingAdapters } = require('./publishing-account-adapters');
const { createBlogPublishingAdapters } = require('./publishing-blog-adapters');
const { createHashnodePublishingAdapter } = require('./publishing-hashnode-adapter');
const APPROVALS = { pinterest: 'PINTEREST_STANDARD_ACCESS_APPROVED', medium: 'MEDIUM_LEGACY_ACCESS_APPROVED', dribbble: 'DRIBBBLE_USE_APPROVED' };
const RECEIPT_KEYS = ['status', 'delivery', 'postedUrl', 'publishId', 'providerId', 'destinationId', 'authorId', 'providerStatus', 'privacyStatus', 'mediaType', 'error', 'deliveryUncertain', 'processingProgress', 'processingTimeLeftMs', 'statusCheckedAt'];

function createPublishingTargets(options) {
  const env = options.env || process.env;
  const adapters = { ...createAccountPublishingAdapters(options), ...createBlogPublishingAdapters(options), hashnode_blog: createHashnodePublishingAdapter(options) };
  function capability(platform) {
    const adapter = adapters[platform];
    if (!adapter) return null;
    const approval = APPROVALS[platform];
    return { ...adapter.capability, ...(approval && String(env[approval] || '').trim().toLowerCase() !== 'true' ? { supported: false, approvalRequired: true, note: `${adapter.capability.label} requires verified provider approval.` } : {}) };
  }
  function receipt(value) {
    if (!value || !['posted', 'processing', 'handoff', 'failed'].includes(value.status)) throw new Error('The provider did not return a valid publishing receipt. Check the destination before retrying.');
    return Object.fromEntries(RECEIPT_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  }
  return { has: platform => Boolean(adapters[platform]), capability,
    destinations: (platform, token, query) => adapters[platform].destinations(token, query),
    publish: async (platform, token, input) => receipt(await adapters[platform].publish(token, input)),
    canSync: platform => typeof adapters[platform]?.sync === 'function',
    sync: async (platform, token, target) => receipt(await adapters[platform].sync(token, target)),
    syncMany: async (platform, token, targets) => {
      const adapter = adapters[platform];
      const results = typeof adapter?.syncMany === 'function' ? await adapter.syncMany(token, targets)
        : await Promise.all(targets.map(target => adapter.sync(token, target)));
      if (!Array.isArray(results) || results.length !== targets.length) throw new Error('The provider did not confirm each requested video status.');
      return results.map(receipt);
    },
  };
}

module.exports = { createPublishingTargets };
