const { resolveApiBase } = require('./security/apiConfig');
const development = process.env.APP_ENV === 'development' && process.env.EAS_BUILD_PROFILE !== 'production';

export default ({ config }) => ({
  ...config,
  name: 'UFIConnect',
  slug: 'pro-connect',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  updates: {
    // Enable only after configuring a trusted endpoint and signed updates.
    enabled: false,
    fallbackToCacheTimeout: 0,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'org.uficonnect.app',
    buildNumber: '1',
    infoPlist: {
      NSPhotoLibraryUsageDescription: 'UFIConnect uses your photo library to share images in messages.',
      NSCameraUsageDescription: 'UFIConnect uses your camera to capture photos to share.',
      NSMicrophoneUsageDescription: 'UFIConnect uses your microphone for voice messages.',
      ITSAppUsesNonExemptEncryption: false,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: development,
      },
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#102A6B',
    },
    package: 'org.uficonnect.app',
    versionCode: 1,
    allowBackup: false,
    blockedPermissions: [
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  extra: {
    // Set API_URL env var when running EAS builds for production.
    // e.g.: eas env:create --environment production --name API_URL --value https://api.uficonnect.org
    apiUrl: resolveApiBase(process.env.API_URL || undefined, development),
    eas: {
      projectId: 'ee9644f6-0881-49a8-93f5-aa373a67bc92',
    },
  },
  plugins: [
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#102A6B' }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    'expo-system-ui',
    './plugins/withSecurity',
  ],
});
