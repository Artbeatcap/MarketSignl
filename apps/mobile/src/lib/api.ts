import { Platform } from 'react-native';
import type {
  GetHistoryResponse,
  GetAnalysisResponse,
  UsageResponse,
  AuthResponse,
} from '@chartsignl/core';

import { API_URL } from './apiConfig';
import { getAccessToken } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

// Get access token: web = localStorage (avoids Supabase getSession hang), native = Supabase SecureStore
async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (!SUPABASE_URL || typeof SUPABASE_URL !== 'string') return null;
    try {
      const storageKey = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`;
      const storedData = localStorage.getItem(storageKey);
      if (storedData) {
        const parsed = JSON.parse(storedData);
        return parsed?.access_token || null;
      }
    } catch (error) {
      console.error('Error reading token from storage:', error);
    }
    return null;
  }
  // Native (iOS/Android): use Supabase session via SecureStore
  const token = await getAccessToken();
  return token ?? null;
}

// Generic fetch wrapper with auth
// Pass explicit accessToken when available (e.g. from auth store) to avoid localStorage/key issues
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const token = accessToken ?? (await getToken());
  
  if (!token) {
    throw new Error('Not authenticated');
  }

  const fullUrl = `${API_URL}${endpoint}`;
  
  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Get analysis history
export async function getAnalysisHistory(
  page = 1,
  limit = 20
): Promise<GetHistoryResponse> {
  return apiFetch(`/api/analyses?page=${page}&limit=${limit}`);
}

// Get single analysis
export async function getAnalysis(id: string): Promise<GetAnalysisResponse> {
  return apiFetch(`/api/analyses/${id}`);
}

// Delete analysis
export async function deleteAnalysis(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/analyses/${id}`, { method: 'DELETE' });
}

// Get current user
export async function getCurrentUser(): Promise<AuthResponse> {
  return apiFetch('/api/user/me');
}

// Get usage stats
export async function getUsage(): Promise<UsageResponse> {
  return apiFetch('/api/user/usage');
}

// Update profile
export async function updateProfile(data: Record<string, unknown>): Promise<{ success: boolean }> {
  return apiFetch('/api/user/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

// Subscription API methods
export interface SubscriptionStatusResponse {
  isActive: boolean;
  expiresAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  platform?: 'web' | 'ios' | 'android';
}

export async function getSubscriptionStatus(accessToken?: string | null): Promise<SubscriptionStatusResponse> {
  try {
    const result = await apiFetch('/api/subscription/status', {}, accessToken);
    return result;
  } catch (error) {
    throw error;
  }
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
}

export async function createCheckoutSession(accessToken?: string | null): Promise<CheckoutSessionResponse> {
  return apiFetch(
    '/api/subscription/create-checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    accessToken
  );
}

export interface CustomerPortalResponse {
  success: boolean;
  url?: string;
  error?: string;
}

export async function createCustomerPortalSession(accessToken?: string | null): Promise<CustomerPortalResponse> {
  return apiFetch(
    '/api/subscription/customer-portal',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    accessToken
  );
}
