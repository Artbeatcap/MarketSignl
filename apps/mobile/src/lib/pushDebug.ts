// Clean-room push registration probe — localizes where registration dies on device builds.
// Wire to a debug button; read the Alert trace on release builds (no Metro console).

import { Platform, Alert } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';
import { API_URL } from './apiConfig';

const REGISTER_PATH = '/api/notifications/register-token';

const buildBody = (token: string) => ({
  token,
  platform: Platform.OS,
  deviceId: Device.osBuildId ?? null,
});

export async function pushDebugProbe(): Promise<void> {
  const steps: string[] = [];
  const log = (m: string) => {
    steps.push(m);
    console.log('[pushDebug]', m);
  };
  const finish = (final: string) => {
    steps.push(final);
    console.log('[pushDebug]', final);
    Alert.alert('Push probe', steps.join('\n'));
  };

  try {
    log(`platform=${Platform.OS} isDevice=${Device.isDevice}`);
    if (!Device.isDevice) return finish('ABORT: not a physical device.');

    const projectId =
      (Constants as { expoConfig?: { extra?: { eas?: { projectId?: string } } } })
        ?.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;
    log(`projectId=${projectId ?? 'MISSING'}`);
    if (!projectId) return finish('ABORT: no EAS projectId surfaced to the build.');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('price-alerts', {
        name: 'Price Alerts',
        importance: Notifications.AndroidImportance.HIGH,
      });
      log('android channel "price-alerts" set');
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    log(`perm existing=${status}`);
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
      log(`perm requested=${status}`);
    }
    if (status !== 'granted') return finish('ABORT: notification permission not granted.');

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResp.data;
    log(`TOKEN=${token}`);

    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess?.session?.access_token;
    log(`session=${accessToken ? 'yes' : 'NO'}`);
    if (!accessToken) return finish('ABORT: no Supabase session (not logged in).');

    const res = await fetch(`${API_URL}${REGISTER_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildBody(token)),
    });
    const bodyText = await res.text();
    log(`register HTTP=${res.status}`);
    log(`register body=${bodyText.slice(0, 300)}`);

    return finish(
      res.ok
        ? 'DONE: token POSTed OK. Re-run Test A — push_tokens should have a row.'
        : `FAIL: backend rejected registration (HTTP ${res.status}).`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const iosHint =
      Platform.OS === 'ios' && /apns|invalidcredentials|push/i.test(msg)
        ? ' Upload APNs .p8 to EAS (production). See apps/mobile/scripts/setup-ios-push.ps1.'
        : '';
    return finish(`THREW: ${msg}${iosHint}`);
  }
}
