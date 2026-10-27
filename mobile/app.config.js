const { resolveApiBase } = require('./security/apiConfig');
const vpnBuildOptions = require('./native-vpn/build-options.json');
const development = process.env.APP_ENV === 'development' && process.env.EAS_BUILD_PROFILE !== 'production';

export default ({ config }) => ({
  ...config,
  name: 'UFIConnect',
  slug: 'ufic',
  owner: 'uficonnect',
  version: '1.0.0',
  scheme: [...new Set(['uficonnect', ...(Array.isArray(config.scheme) ? config.scheme : config.scheme ? [config.scheme] : [])])].filter(value => value !== 'uficonnect-vpn'),
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
    buildNumber: '17',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'UFIConnect uses your location to show nearby feed posts, places, and account recommendations when you use location features.',
      NSPhotoLibraryUsageDescription: 'Choose photos and videos to share in posts, messages, or your profile.',
      NSCameraUsageDescription: 'Take a photo or video when you choose to attach one to a post, message, or your profile.',
      NSMicrophoneUsageDescription: 'Record audio when you choose to capture a video or audio attachment.',
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: development,
      },
    },
  },
  android: {
    scheme: ['uficonnect', 'uficonnect-vpn'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#102A6B',
    },
    package: 'org.uficonnect.app',
    versionCode: 11,
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
      projectId: '230828f2-53a3-4f87-a262-f2946e821eeb',
    },
  },
  plugins: [
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#102A6B' }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    'expo-system-ui',
    './plugins/withSecurity',
    ['./native-vpn/withUfiVpn', vpnBuildOptions],
  ],
});
