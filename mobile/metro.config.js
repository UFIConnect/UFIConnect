const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.watcher = {
  ...config.watcher,
  watchman: false,
  ignorePattern: [
    "**/node_modules/**",
    "**/.git/**",
    "**/.idea/**",
    "**/.vscode/**",
  ],
};

// Ensure Metro resolves modules from the mobile node_modules folder only.
config.resolver = {
  ...config.resolver,
  nodeModulesPath: [path.resolve(__dirname, 'node_modules')],
};

module.exports = config;
