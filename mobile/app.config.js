export default ({ config }) => ({
  ...config,
  name: 'UFIConnect',
  slug: 'pro-connect',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'cover',
    backgroundColor: '#102A6B',
  },
  updates: {
    fallbackToCacheTimeout: 0,
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.uficonnect.app',
    buildNumber: '1',
    infoPlist: {
      NSPhotoLibraryUsageDescription: 'UFIConnect uses your photo library to share images in messages.',
      NSCameraUsageDescription: 'UFIConnect uses your camera to capture photos to share.',
      NSMicrophoneUsageDescription: 'UFIConnect uses your microphone for voice messages.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#102A6B',
    },
    package: 'com.uficonnect.app',
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
    // e.g.: eas env:create --environment production --name API_URL --value https://api.uficonnect.org
    apiUrl: process.env.API_URL || 'https://api.uficonnect.org',
    eas: {
      projectId: 'ee9644f6-0881-49a8-93f5-aa373a67bc92',
    },
  },
  plugins: [],
});
