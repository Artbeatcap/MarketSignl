import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../store/authStore';
import { API_URL } from '../lib/apiConfig';

export interface PriceAlert {
  id: string;
  user_id: string;
  analysis_id: string | null;
  symbol: string;
  level_price: number;
  level_type: 'support' | 'resistance';
  level_strength: string | null;
  level_description: string | null;
  direction: 'crosses_above' | 'crosses_below' | 'either';
  status: 'active' | 'triggered' | 'expired' | 'disabled';
  last_known_price: number | null;
  last_checked_at: string | null;
  triggered_at: string | null;
  triggered_price: number | null;
  notification_sent: boolean;
  expires_at: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateAlertParams {
  symbol: string;
  levelPrice: number;
  levelType: 'support' | 'resistance';
  direction?: 'crosses_above' | 'crosses_below' | 'either';
  levelDescription?: string;
}

export const alertKeys = {
  all: ['alerts'] as const,
  active: () => [...alertKeys.all, 'active'] as const,
  history: () => [...alertKeys.all, 'history'] as const,
};

async function apiGetJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Request failed');
  }

  return (await res.json()) as T;
}

async function apiPostJson<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'Request failed');
  }

  return (await res.json()) as T;
}

async function apiDeleteJson<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'Request failed');
  }

  return (await res.json()) as T;
}

async function apiPutJson<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'Request failed');
  }

  return (await res.json()) as T;
}

export function useActiveAlerts() {
  const { session } = useAuthStore();

  return useQuery({
    queryKey: alertKeys.active(),
    enabled: !!session?.access_token,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      const data = await apiGetJson<{ success: boolean; alerts: PriceAlert[] }>(
        '/api/notifications/alerts?status=active',
        session!.access_token
      );
      return data.alerts;
    },
  });
}

export function useAllAlerts() {
  const { session } = useAuthStore();

  return useQuery({
    queryKey: alertKeys.all,
    enabled: !!session?.access_token,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const data = await apiGetJson<{ success: boolean; alerts: PriceAlert[] }>(
        '/api/notifications/alerts',
        session!.access_token
      );
      return data.alerts;
    },
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  const { session } = useAuthStore();

  return useMutation({
    mutationFn: async (params: CreateAlertParams) => {
      const data = await apiPostJson<{ success: boolean; alert: PriceAlert }>(
        '/api/notifications/alerts',
        params,
        session!.access_token
      );

      if (!data?.success) {
        throw new Error('Failed to create alert');
      }

      return data.alert;
    },
    onSuccess: () => {
      // Refresh both "all" and "active" views.
      queryClient.invalidateQueries({ queryKey: alertKeys.all });
      queryClient.invalidateQueries({ queryKey: alertKeys.active() });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();
  const { session } = useAuthStore();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const data = await apiDeleteJson<{ success: boolean }>(
        `/api/notifications/alerts/${alertId}`,
        {},
        session!.access_token
      );

      if (!data?.success) {
        throw new Error('Failed to delete alert');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.all });
      queryClient.invalidateQueries({ queryKey: alertKeys.active() });
    },
  });
}

export function useToggleAlert() {
  const queryClient = useQueryClient();
  const { session } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      alertId,
      status,
    }: {
      alertId: string;
      status: 'active' | 'disabled';
    }) => {
      const data = await apiPutJson<{ success: boolean; alert: PriceAlert }>(
        `/api/notifications/alerts/${alertId}`,
        { status },
        session!.access_token
      );

      if (!data?.success) {
        throw new Error('Failed to update alert');
      }

      return data.alert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.all });
      queryClient.invalidateQueries({ queryKey: alertKeys.active() });
    },
  });
}

export function useNotificationHistory(limit = 20) {
  const { session } = useAuthStore();

  return useQuery({
    queryKey: [...alertKeys.history(), limit],
    enabled: !!session?.access_token,
    queryFn: async () => {
      const data = await apiGetJson<{ success: boolean; notifications: PriceAlert[] }>(
        `/api/notifications/history?limit=${encodeURIComponent(String(limit))}`,
        session!.access_token
      );
      // Backend returns `notification_log` rows; shape may differ from PriceAlert.
      // Keep caller responsibility for rendering.
      return (data.notifications || []) as unknown[];
    },
  });
}

