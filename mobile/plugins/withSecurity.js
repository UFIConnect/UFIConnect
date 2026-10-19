const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');
const { DATA_EXTRACTION_RULES, secureApplicationManifest } = require('../security/androidConfig');

module.exports = function withSecurity(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const development = process.env.APP_ENV === 'development' && process.env.EAS_BUILD_PROFILE !== 'production';
    secureApplicationManifest(application, development);
    // WebView checks resolveActivity before opening the system camera. These
    // Android package-visibility queries grant no camera or microphone access.
    const queries = mod.modResults.manifest.queries || (mod.modResults.manifest.queries = []);
    if (!queries.length) queries.push({});
    const intents = queries[0].intent || (queries[0].intent = []);
    for (const name of ['android.media.action.IMAGE_CAPTURE', 'android.media.action.VIDEO_CAPTURE']) {
      const present = queries.some(query => (query.intent || []).some(intent => !intent.data?.length && !intent.category?.length
        && (intent.action || []).some(action => action.$?.['android:name'] === name)));
      if (!present) intents.push({ action: [{ $: { 'android:name': name } }] });
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'security_data_extraction_rules.xml'), DATA_EXTRACTION_RULES);
    return mod;
  }]);
};
