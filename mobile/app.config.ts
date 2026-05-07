import 'dotenv/config';
import type { ExpoConfig, ConfigContext } from '@expo/config';

const projectName = 'Arise Mobile';
const projectSlug = 'arise-mobile';
const projectId = '55d6c0b6-661b-49bd-bcfc-48fea809322d';

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';

  return {
    ...config,
    owner: 'martinwamb',
    name: projectName,
    slug: projectSlug,
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.ariseandshine.mobile',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: 'com.ariseandshine.mobile',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-secure-store',
      ['expo-notifications', {
        icon: './assets/icon.png',
        color: '#0f172a',
        defaultChannel: 'default',
      }],
    ],
    extra: {
      apiBase,
      eas: {
        projectId: '55d6c0b6-661b-49bd-bcfc-48fea809322d',
      },
    },
    experiments: {
      typedRoutes: true,
    },
  };
};
