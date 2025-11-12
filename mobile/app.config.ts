import 'dotenv/config';
import type { ExpoConfig, ConfigContext } from '@expo/config';

const projectName = 'Arise Mobile';
const projectSlug = 'arise-mobile';
const projectId = 'd0147d54-e8aa-450f-acc7-3c24bc6c72bf';

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';

  return {
    ...config,
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
    plugins: ['expo-secure-store'],
    extra: {
      apiBase,
      eas: {
        projectId,
      },
    },
    experiments: {
      typedRoutes: true,
    },
  };
};
