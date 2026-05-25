export default ({ config }) => ({
  ...config,
  name: 'ProConnect',
  slug: 'pro-connect',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'cover',
    backgroundColor: '#2563EB',
  },
  updates: {
    fallbackToCacheTimeout: 0,
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.proconnect.app',
    buildNumber: '1',
    infoPlist: {
      NSPhotoLibraryUsageDescription: 'ProConnect uses your photo library to share images in messages.',
      NSCameraUsageDescription: 'ProConnect uses your camera to capture photos to share.',
      NSMicrophoneUsageDescription: 'ProConnect uses your microphone for voice messages.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2563EB',
    },
    package: 'com.proconnect.app',
    versionCode: 1,
    permissions: [
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    // Set API_URL env var when running EAS builds for production.
    // e.g.: eas secret:create --scope project --name API_URL --value https://api.proconnect.app
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    eas: {
      projectId: '', // Run `eas init` to populate this field automatically
    },
  },
  plugins: [],
});
