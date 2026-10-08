const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// Expo supplies compatible resolution, package exports, and platform defaults.
const config = getDefaultConfig(__dirname);
// The maintained account screen shares taxonomy and public provider metadata.
config.watchFolders = [...new Set([...config.watchFolders,
  path.resolve(__dirname, '../shared'), path.resolve(__dirname, '../backend'),
])];
module.exports = config;
