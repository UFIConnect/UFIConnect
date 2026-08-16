export default ({ config }) => ({
  ...config,
  name: 'UFconnect',
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
    bundleIdentifier: 'com.uficonnect.app',
    buildNumber: '1',
    infoPlist: {
      NSPhotoLibraryUsageDescription: 'UFconnect uses your photo library to share images in messages.',
      NSCameraUsageDescription: 'UFconnect uses your camera to capture photos to share.',
      NSMicrophoneUsageDescription: 'UFconnect uses your microphone for voice messages.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2563EB',
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
    // e.g.: eas secret:create --scope project --name API_URL --value https://uficonnect-api-708r.onrender.com
    apiUrl: process.env.API_URL || 'https://uficonnect-api-708r.onrender.com',
    eas: {
      projectId: 'ee9644f6-0881-49a8-93f5-aa373a67bc92',
    },
  },
  plugins: [],
});
