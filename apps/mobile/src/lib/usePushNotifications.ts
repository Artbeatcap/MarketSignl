import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { useAuthStore } from '../store/authStore';
import { API_URL } from './apiConfig';

// Keep the latest token available for logout unregistration.
let latestExpoPushToken: string | null = null;

export function getExpoPushToken(): string | null {
  return latestExpoPushToken;
}

type PlatformName = 'ios' | 'android';

interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  error: string | null;
}

// Configure how notifications behave when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  try {
    // Android/iOS simulators can be unreliable for push tokens.
    if (!Device.isDevice) {
      return null;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    const projectId =
      // EAS project id comes from app.config.ts `extra.eas.projectId`
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      (Constants as any)?.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      console.error('[PUSH] No EAS project ID found');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenData.data;
    if (!token) return null;

    // Android: create notification channel.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('price-alerts', {
        name: 'Price Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#14B8A6', // ChartSignl teal
        sound: 'default',
        description: 'Notifications when support/resistance levels are crossed',
      });
    }

    return token;
  } catch (error) {
    console.error('[PUSH] Registration error:', error);
    return null;
  }
}

async function registerTokenWithBackend(
  token: string,
  accessToken: string
): Promise<void> {
  try {
    const platform = (Platform.OS as PlatformName) ?? 'android';
    const deviceId = Device.osBuildId ?? null;

    const response = await fetch(`${API_URL}/api/notifications/register-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        platform,
        deviceId,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('[PUSH] Backend registration failed:', body?.error);
      return;
    }
  } catch (error) {
    console.error('[PUSH] Backend registration error:', error);
  }
}

// Remove the token server-side so the user stops receiving notifications after logout.
export async function unregisterPushToken(
  token: string,
  accessToken: string
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/notifications/unregister-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('[PUSH] Unregister failed:', body?.error);
    }
  } catch (error) {
    console.error('[PUSH] Unregister error:', error);
  }
}

export function usePushNotifications(): PushNotificationState {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null
  );
  const responseListener = useRef<Notifications.EventSubscription | null>(
    null
  );

  const { session, isInitialized } = useAuthStore();

  const [state, setState] = useState<PushNotificationState>({
    expoPushToken: null,
    notification: null,
    error: null,
  });

  // 1) Request permission + get Expo push token (runs once when auth/session is ready)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isInitialized) return;
    if (!session?.access_token) return;

    let isMounted = true;

    (async () => {
      try {
        if (!Device.isDevice) {
          if (!isMounted) return;
          setState((s) => ({
            ...s,
            error: 'Push notifications require a physical device',
          }));
          return;
        }

        const token = await registerForPushNotifications();
        if (!token) {
          if (!isMounted) return;
          setState((s) => ({
            ...s,
            error: 'Unable to get Expo push token (permission denied or token unavailable)',
          }));
          return;
        }

        latestExpoPushToken = token;
        if (!isMounted) return;
        setState((s) => ({ ...s, expoPushToken: token, error: null }));
      } catch (e) {
        if (!isMounted) return;
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : 'Push registration failed',
        }));
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [session?.access_token, isInitialized]);

  // 2) Register token with backend when we have both token + access token
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isInitialized) return;
    if (!session?.access_token) return;
    if (!state.expoPushToken) return;

    registerTokenWithBackend(state.expoPushToken, session.access_token);
  }, [session?.access_token, isInitialized, state.expoPushToken]);

  // 3) Listen for notification taps and navigate
  useEffect(() => {
    if (Platform.OS === 'web') return;

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setState((s) => ({ ...s, notification }));
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;

        const type = data?.type;
        if (type !== 'price_alert') return;

        const symbol = typeof data?.symbol === 'string' ? data.symbol : null;
        if (!symbol) return;

        // "Stock screen": interpret as the main Analyze screen for a symbol.
        router.push({
          pathname: '/(tabs)/analyze',
          params: { symbol },
        });
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [router]);

  return state;
}

