import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications(api: any, userId: number | undefined) {
  useEffect(() => {
    if (!userId) return;

    async function register() {
      try {
        if (!Device.isDevice) return;

        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Arise & Shine',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        const token = (await Notifications.getExpoPushTokenAsync({
          projectId: '55d6c0b6-661b-49bd-bcfc-48fea809322d',
        })).data;

        await api.post('/api/me/push-token', { token });
      } catch {
        // Silently fail — push is non-critical
      }
    }

    register();
  }, [userId, api]);
}
