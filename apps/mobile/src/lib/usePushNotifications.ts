import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { useAuthStore } from '../store/authStore';
import { API_URL } from './apiConfig';

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

type PushSnapshot = PushNotificationState;

let snapshot: PushSnapshot = {
  expoPushToken: null,
  notification: null,
  error: null,
};

const snapshotListeners = new Set<() => void>();

function getSnapshot(): PushSnapshot {
  return snapshot;
}

function subscribeSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

function updateSnapshot(partial: Partial<PushSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  snapshotListeners.forEach((listener) => listener());
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function pushErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

async function registerForPushNotifications(): Promise<RegisterResult> {
  if (!Device.isDevice) {
    return { ok: false, error: 'Push notifications require a physical device' };
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return {
      ok: false,
      error: 'Notification permission denied. Enable notifications in device settings.',
    };
  }

  const projectId =
    (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | undefined)
      ?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (!projectId) {
    return { ok: false, error: 'EAS project ID missing from this build.' };
  }

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('price-alerts', {
        name: 'Price Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#14B8A6',
        sound: 'default',
        description: 'Notifications when support/resistance levels are crossed',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    if (!token) {
      return { ok: false, error: 'Expo returned an empty push token.' };
    }

    return { ok: true, token };
  } catch (error) {
    console.error('[PUSH] Registration error:', error);
    const msg = pushErrorMessage(error);
    const hint =
      Platform.OS === 'android' && /firebase|fcm|google-services/i.test(msg)
        ? ' Android builds need google-services.json and FCM credentials (see apps/mobile/google-services.json).'
        : Platform.OS === 'ios' && /apns|invalidcredentials|push/i.test(msg)
          ? ' iOS builds need an APNs .p8 key uploaded to EAS (production profile). Run apps/mobile/scripts/setup-ios-push.ps1.'
          : '';
    return { ok: false, error: `${msg}${hint}` };
  }
}

async function registerTokenWithBackend(
  token: string,
  accessToken: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = (Platform.OS as PlatformName) ?? 'android';
    const deviceId = Device.osBuildId ?? null;

    const response = await fetch(`${API_URL}/api/notifications/register-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token, platform, deviceId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail =
        typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      console.error('[PUSH] Backend registration failed:', detail);
      return { ok: false, error: `Backend registration failed: ${detail}` };
    }

    return { ok: true };
  } catch (error) {
    console.error('[PUSH] Backend registration error:', error);
    return { ok: false, error: `Backend registration error: ${pushErrorMessage(error)}` };
  }
}

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

let registrationPromise: Promise<void> | null = null;
let lastRegisteredAccessToken: string | null = null;

async function runPushRegistration(accessToken: string): Promise<void> {
  const tokenResult = await registerForPushNotifications();
  if (!tokenResult.ok) {
    updateSnapshot({ error: tokenResult.error, expoPushToken: null });
    latestExpoPushToken = null;
    return;
  }

  latestExpoPushToken = tokenResult.token;
  updateSnapshot({ expoPushToken: tokenResult.token, error: null });

  const backendResult = await registerTokenWithBackend(
    tokenResult.token,
    accessToken
  );
  if (!backendResult.ok) {
    updateSnapshot({ error: backendResult.error });
  }
}

function ensurePushRegistration(accessToken: string): void {
  if (registrationPromise) return;

  const alreadyRegistered =
    lastRegisteredAccessToken === accessToken &&
    snapshot.expoPushToken !== null &&
    snapshot.error === null;
  if (alreadyRegistered) return;

  lastRegisteredAccessToken = accessToken;
  registrationPromise = runPushRegistration(accessToken).finally(() => {
    registrationPromise = null;
  });
}

export function usePushNotifications(): PushNotificationState {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const listenersAttached = useRef(false);

  const { session, isInitialized } = useAuthStore();
  const state = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isInitialized) return;
    if (!session?.access_token) return;
    ensurePushRegistration(session.access_token);
  }, [session?.access_token, isInitialized]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (listenersAttached.current) return;
    listenersAttached.current = true;

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        updateSnapshot({ notification });
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;

        if (data?.type !== 'price_alert') return;

        const symbol = typeof data?.symbol === 'string' ? data.symbol : null;
        if (!symbol) return;

        router.push({
          pathname: '/(tabs)/analyze',
          params: { symbol },
        });
      });

    return () => {
      listenersAttached.current = false;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);

  return state;
}
