const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// SDK 57's DOM export hashes bundle filenames without updating split-chunk
// dependencies. A single bundle keeps native DOM and browser exports complete.
process.env.EXPO_NO_BUNDLE_SPLITTING = '1';

// Expo supplies compatible resolution, package exports, and platform defaults.
const config = getDefaultConfig(__dirname);
// The maintained account screen shares taxonomy and public provider metadata.
config.watchFolders = [...new Set([...config.watchFolders,
  path.resolve(__dirname, '../shared'), path.resolve(__dirname, '../backend'),
  path.resolve(__dirname, '../web'),
])];
config.transformerPath = require.resolve('./current-site/metro-transformer.cjs');
// Expo's supervising worker retains its own getCacheKey. Salt Metro's supported
// cacheVersion instead, covering our transformer, public config and CSS font.
const websiteHash = crypto.createHash('sha256');
for (const source of ['./current-site/metro-transformer.cjs', './current-site/website-transform.cjs', '../web/public/brand/google-sans-medium.woff2', '../web/src/assets/snap-profile-default.svg']) {
  websiteHash.update(fs.readFileSync(path.resolve(__dirname, source)));
}
websiteHash.update(JSON.stringify(require('./current-site/website-transform.cjs').publicEnvironment()));
config.cacheVersion = `${config.cacheVersion || ''}|ufi-website-${websiteHash.digest('hex')}`;
const mobilePackages = new Set(Object.keys(require('./package.json').dependencies));
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const packageName = moduleName.startsWith('@') ? moduleName.split('/').slice(0, 2).join('/') : moduleName.split('/')[0];
  // Shared website code must use Expo's React pair and the mobile lockfile.
  if (mobilePackages.has(packageName)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(__dirname, 'package.json') }, moduleName, platform);
  }
  return upstreamResolve ? upstreamResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
