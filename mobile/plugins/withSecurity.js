const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');
const { DATA_EXTRACTION_RULES, secureApplicationManifest } = require('../security/androidConfig');

module.exports = function withSecurity(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const development = process.env.APP_ENV === 'development' && process.env.EAS_BUILD_PROFILE !== 'production';
    secureApplicationManifest(application, development);
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'security_data_extraction_rules.xml'), DATA_EXTRACTION_RULES);
    return mod;
  }]);
};
