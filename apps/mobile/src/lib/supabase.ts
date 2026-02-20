import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Check .env and rebuild.'
  );
}

// Custom storage adapter for React Native with timeout protection
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      // Add timeout to prevent hanging on SecureStore
      return await Promise.race([
        SecureStore.getItemAsync(key),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
      ]);
    } catch (error) {
      console.error('Error getting item from storage:', error);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
        return;
      }
      // Add timeout to prevent hanging on SecureStore
      await Promise.race([
        SecureStore.setItemAsync(key, value),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('Storage timeout')), 2000)
        )
      ]);
    } catch (error) {
      console.error('Error setting item in storage:', error);
      // Don't throw - allow auth to continue even if storage fails
    }
  },
  removeItem: async (key: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
        return;
      }
      // Add timeout to prevent hanging on SecureStore
      await Promise.race([
        SecureStore.deleteItemAsync(key),
        new Promise<void>((resolve) => setTimeout(() => resolve(), 2000))
      ]);
    } catch (error) {
      console.error('Error removing item from storage:', error);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Auth helper functions
export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

// Cache for in-flight getSession requests to prevent multiple simultaneous calls
let sessionPromise: Promise<any> | null = null;
let lastSessionFetch = 0;
const SESSION_CACHE_MS = 1000; // Cache session for 1 second

export async function getAccessToken() {
  try {
    // If there's already a getSession call in progress, reuse it
    if (sessionPromise && (Date.now() - lastSessionFetch < SESSION_CACHE_MS)) {
      const { data } = await sessionPromise;
      return data.session?.access_token;
    }
    
    // Create new getSession request with timeout
    lastSessionFetch = Date.now();
    sessionPromise = Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((_, reject) => 
        setTimeout(() => reject(new Error('getSession timeout')), 3000)
      )
    ]).finally(() => {
      // Clear the promise after it completes (success or error)
      sessionPromise = null;
    });
    
    const { data } = await sessionPromise;
    return data.session?.access_token;
  } catch (error) {
    throw error;
  }
}
