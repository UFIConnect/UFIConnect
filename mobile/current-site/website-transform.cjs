const path = require('node:path');
const fs = require('node:fs');
const websiteRoot = path.resolve(__dirname, '../../web/src') + path.sep;
const assetModule = path.resolve(__dirname, 'publicAsset.js');
const snapAvatarAsset = path.resolve(websiteRoot, 'assets/snap-profile-default.svg');
const publicAssetPattern = /^\/(?:brand\/|media\/|downloads\/|[^/?#]+\.(?:svg|png|jpe?g|webp|ico)(?:[?#]|$))/i;

function publicEnvironment() {
  // Only explicitly public settings may enter the client bundle.
  return {
    VITE_API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.uficonnect.org',
    VITE_API_FALLBACK_URL: '',
    VITE_ANALYTICS_BRIDGE_URL: 'https://api.uficonnect.org/analytics-bridge.html',
    VITE_MAINTENANCE_MODE: 'false', VITE_VAULT_LOCAL_PREVIEW: 'false',
    VITE_AUTH0_DOMAIN: process.env.EXPO_PUBLIC_AUTH0_DOMAIN || '',
    VITE_AUTH0_CLIENT_ID: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID || '',
    VITE_AUTH0_AUDIENCE: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE || '',
    BASE_URL: '/', PROD: process.env.NODE_ENV === 'production',
    DEV: process.env.NODE_ENV !== 'production',
    MODE: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  };
}
module.exports = function websiteTransform({ types: t }) {
  function isWebsite(state) { return state.filename?.startsWith(websiteRoot); }
  function wrapAsset(node, sourcePath, state) {
    const program = sourcePath.findParent(p => p.isProgram());
    if (!state.ufiAssetIdentifier) {
      state.ufiAssetIdentifier = program.scope.generateUidIdentifier('ufiPublicAsset');
      program.unshiftContainer('body', t.importDeclaration([
        t.importSpecifier(state.ufiAssetIdentifier, t.identifier('publicAsset')),
      ], t.stringLiteral(assetModule)));
    }
    const replacement = t.callExpression(t.cloneNode(state.ufiAssetIdentifier), [node]);
    sourcePath.replaceWith(sourcePath.parentPath.isJSXAttribute() ? t.jsxExpressionContainer(replacement) : replacement);
    sourcePath.skip();
  }
  return { name: 'ufi-shared-website-public-config', visitor: {
    ImportDeclaration(sourcePath, state) {
      if (!isWebsite(state) || !sourcePath.node.source.value.startsWith('.')) return;
      const imported = path.resolve(path.dirname(state.filename), sourcePath.node.source.value);
      if (imported !== snapAvatarAsset) return;
      const specifiers = sourcePath.node.specifiers;
      if (specifiers.length !== 1 || !t.isImportDefaultSpecifier(specifiers[0])) {
        throw sourcePath.buildCodeFrameError('The local Snap avatar must use a default image import.');
      }
      // Expo's native update export and embedded DOM disagree about imported
      // image paths. This one 256-byte first-party fallback is needed offline;
      // embed its exact bytes while the regular website keeps its SVG import.
      sourcePath.replaceWith(t.variableDeclaration('const', [t.variableDeclarator(
        t.cloneNode(specifiers[0].local),
        t.stringLiteral(`data:image/svg+xml;base64,${fs.readFileSync(snapAvatarAsset).toString('base64')}`),
      )]));
    },
    MemberExpression(sourcePath, state) {
      if (!isWebsite(state)) return;
      const { object, property, computed } = sourcePath.node;
      if (!t.isMemberExpression(object) || !t.isMetaProperty(object.object)
        || object.object.meta.name !== 'import' || object.object.property.name !== 'meta'
        || object.property.name !== 'env') return;
      const key = computed && t.isStringLiteral(property) ? property.value : property.name;
      const env = publicEnvironment();
      if (!Object.hasOwn(env, key)) throw sourcePath.buildCodeFrameError(`Unsupported public website setting: ${key}`);
      sourcePath.replaceWith(t.valueToNode(env[key]));
    },
    StringLiteral(sourcePath, state) {
      if (!isWebsite(state) || !publicAssetPattern.test(sourcePath.node.value)) return;
      if (sourcePath.parentPath.isImportDeclaration() || sourcePath.parentPath.isExportDeclaration()
        || (sourcePath.parentPath.isObjectProperty() && sourcePath.key === 'key')) return;
      wrapAsset(t.cloneNode(sourcePath.node), sourcePath, state);
    },
    TemplateLiteral(sourcePath, state) {
      if (!isWebsite(state) || !publicAssetPattern.test(sourcePath.node.quasis[0]?.value.cooked || '')) return;
      wrapAsset(t.cloneNode(sourcePath.node, true), sourcePath, state);
    },
  } };
};
module.exports.publicEnvironment = publicEnvironment;
