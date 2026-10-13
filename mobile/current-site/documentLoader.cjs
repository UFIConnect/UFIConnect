const HASHED_HTML = /^[a-f0-9]{32}\.html$/;
const LOAD_ERROR_DOMAINS = new Set(['NSURLErrorDomain', 'WKErrorDomain', 'WebKitErrorDomain']);

class BundledDocumentError extends Error {
  constructor(code, message) {
    super(`${message} (${code})`);
    this.name = 'BundledDocumentError';
    this.code = code;
  }
}

function bundleError(code = 'APP_BUNDLE_UNREADABLE') {
  return new BundledDocumentError(code, code === 'APP_BUNDLE_MISSING'
    ? 'The app’s bundled page is missing. Please reinstall UFIConnect.'
    : 'The app’s bundled page could not be opened. Please reinstall UFIConnect.');
}

function verifiedDirectoryUri(value, platform) {
  if (platform === 'android') {
    // Expo FileSystem enumerates APK assets with asset:// URIs. WebView uses
    // android_asset instead; admit only this exact packaged directory.
    if (value !== 'asset:///www.bundle' && value !== 'asset:///www.bundle/') throw bundleError('APP_BUNDLE_INVALID');
    return 'asset:///www.bundle/';
  }
  if (typeof value !== 'string' || !value.startsWith('file:///') || /[\u0000-\u0020\\?#]/.test(value)) throw bundleError('APP_BUNDLE_INVALID');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw bundleError('APP_BUNDLE_INVALID'); }
  if (/[\u0000-\u001f\\?#]/.test(decoded) || /%(?:2f|5c)/i.test(value)
    || decoded.split('/').some(part => part === '.' || part === '..')) throw bundleError('APP_BUNDLE_INVALID');
  const uri = value.replace(/\/?$/, '/');
  if (!uri.endsWith('/www.bundle/')) throw bundleError('APP_BUNDLE_INVALID');
  return uri;
}

// The production document and WKWebView's read-access directory come from the
// same native Directory object. Do not rely on a second relative-URL resolver.
// Keep development entirely on Expo's Metro URL without touching bundle files.
function resolveBundledDocument({ development, platform = 'ios', openDirectory, isFile }) {
  if (development) return null;
  try {
    const directory = openDirectory();
    const storageUri = verifiedDirectoryUri(directory.uri, platform);
    if (!directory.exists) throw bundleError('APP_BUNDLE_MISSING');
    const entries = directory.list();
    const documents = entries.filter(entry => HASHED_HTML.test(entry.name));
    if (documents.length === 0) throw bundleError('APP_BUNDLE_MISSING');
    if (documents.length !== 1) throw bundleError('APP_BUNDLE_AMBIGUOUS');
    const document = documents[0];
    if (!isFile(document) || document.uri !== storageUri + document.name) throw bundleError('APP_BUNDLE_INVALID');
    if (!document.exists) throw bundleError('APP_BUNDLE_MISSING');
    const readAccessUri = platform === 'android' ? 'file:///android_asset/www.bundle/' : storageUri;
    return Object.freeze({ documentUri: readAccessUri + document.name, readAccessUri });
  } catch (error) {
    if (error instanceof BundledDocumentError) throw error;
    // Native filesystem errors can contain device paths. Never show those.
    throw bundleError();
  }
}

function documentLoadError(event) {
  const details = event?.nativeEvent;
  const domain = LOAD_ERROR_DOMAINS.has(details?.domain) ? details.domain : 'WebView';
  const code = Number.isSafeInteger(details?.code) && Math.abs(details.code) <= 100000 ? ` ${details.code}` : '';
  // Intentionally omit description, URL and all other native event fields.
  return `The app could not open. Please try again. (${domain}${code})`;
}

module.exports = { resolveBundledDocument, documentLoadError };
