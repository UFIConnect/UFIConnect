// Android WebView 13.16.1 selects photoIntent even for video-only capture inputs.
// Keep its permission, chooser, callback and output-file handling unchanged;
// only let a capture input select the already-created video intent when needed.
// Upstream: https://github.com/react-native-webview/react-native-webview/blob/v13.16.1/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewModuleImpl.java
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = '13.16.1';
const JAVA_FILE = 'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewModuleImpl.java';
const BEFORE_SHA256 = 'a7ef68d0ec1f2c1bfe7ffb525e3dba82a72ab9dd2ba8c5bfe7bc9cbe23d23afa';
const AFTER_SHA256 = '900789a558b4265ac29cd80f4a67ab04837e22c1c0f97834ac90d0890ade0097';
const replacements = [
  ['        Intent photoIntent = null;\n', '        Intent photoIntent = null;\n        Intent videoIntent = null;\n'],
  ['                Intent videoIntent = getVideoIntent();', '                videoIntent = getVideoIntent();'],
  ['            chooserIntent = photoIntent;', '            chooserIntent = photoIntent != null ? photoIntent : videoIntent;'],
];
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function patchSnapCamera(text) {
  if (hash(text) === AFTER_SHA256) return text;
  if (hash(text) !== BEFORE_SHA256) throw new Error('Unrecognized react-native-webview camera source; review the pinned patch before upgrading.');
  for (const [before, after] of replacements) {
    if (text.split(before).length !== 2) throw new Error('WebView camera patch context is not unique.');
    text = text.replace(before, after);
  }
  if (hash(text) !== AFTER_SHA256) throw new Error('WebView camera patch result does not match its reviewed hash.');
  return text;
}

function prepareSnapCamera({ directory = path.resolve(__dirname, '..'), apply = false } = {}) {
  const root = fs.realpathSync(path.resolve(directory));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const locked = lock.packages?.['node_modules/react-native-webview'];
  if (locked?.version !== VERSION || locked.link) throw new Error('Unexpected locked react-native-webview version; review the camera patch.');
  const packageRoot = path.join(root, 'node_modules/react-native-webview');
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'react-native-webview' || pkg.version !== VERSION) throw new Error('Unexpected installed react-native-webview version; review the camera patch.');
  const filename = path.join(packageRoot, JAVA_FILE);
  // Local release workspaces sometimes point at another workspace's modules.
  // Read-only verification is safe; applying a patch through that link is not.
  if (apply && fs.realpathSync(filename) !== filename) throw new Error('Refusing to modify linked or shared WebView dependencies; install dependencies in this build workspace first.');
  const current = fs.readFileSync(filename, 'utf8');
  const next = patchSnapCamera(current);
  if (!apply && current !== next) throw new Error('Pinned WebView video-capture fix has not been installed.');
  if (apply && current !== next) fs.writeFileSync(filename, next);
  return { package: pkg.name, version: VERSION, sha256: AFTER_SHA256, changed: apply && current !== next };
}

module.exports = { VERSION, JAVA_FILE, BEFORE_SHA256, AFTER_SHA256, patchSnapCamera, prepareSnapCamera };
if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/prepare-snap-camera.cjs [--check]');
  const result = prepareSnapCamera({ apply: !process.argv.includes('--check') });
  console.log(`Verified react-native-webview ${result.version} photo/video capture fix.`);
}
