import React, { Component, useEffect, useRef } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Platform, Text, Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { subscriptionService } from '../services/subscription.service';
import { colors } from '../theme';

type ErrorBoundaryState = { hasError: boolean; error: Error | null };

class RootErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('RootErrorBoundary caught:', error.message, error.stack);
    // #region agent log
    try {
      const msg = error.message || '';
      fetch('http://127.0.0.1:7243/ingest/40355958-aed9-4b22-9cb1-0b68d3805912', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: '_layout.tsx:RootErrorBoundary.componentDidCatch',
          message: 'RootErrorBoundary caught',
          data: {
            errorMessage: msg,
            hasRNSVG: msg.includes('RNSVG'),
            hasPath: msg.includes('RNSVGPath'),
          },
          timestamp: Date.now(),
          hypothesisId: msg.includes('RNSVG') ? 'H1' : 'H_other',
        }),
      }).catch(() => {});
    } catch (_) {}
    // #endregion
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const showStack = typeof __DEV__ !== 'undefined' && __DEV__ && this.state.error.stack;
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>{this.state.error.message}</Text>
          {showStack ? (
            <Text style={styles.errorStack} selectable>
              {this.state.error.stack}
            </Text>
          ) : null}
          <Text style={styles.errorHint}>Close and reopen the app to try again.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// Temporary diagnostic: RevenueCat Android key at load time (check Logcat)
console.log('RC Android Key:', process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ? 'SET' : 'MISSING');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isInitialized, isLoading, session, user, initialize } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const hasSeenNonEmptySegments = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        await subscriptionService.initialize();
      } catch (error) {
        console.error('Error initializing subscription service:', error);
      }
      try {
        await initialize();
      } catch (error) {
        console.error('Error initializing auth:', error);
      }
    };
    init();
  }, [initialize]);

  // ADD THIS — Diagnostic: log ALL deep links globally
  useEffect(() => {
    console.log('🔗 Setting up global Linking listener');

    // Check if there's already a URL waiting (cold start)
    Linking.getInitialURL().then((url) => {
      console.log('🔗 getInitialURL:', url);
    });

    // Listen for ALL incoming deep links (warm start)
    const sub = Linking.addEventListener('url', (event) => {
      console.log('🔗 DEEP LINK RECEIVED:', event.url);
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isInitialized || isLoading) {
      return;
    }

    // On web, /privacy and /terms are static HTML served by nginx—no auth. If the SPA was
    // loaded for this path (e.g. nginx served index.html), force a full page load so nginx
    // serves the static file and non-users can see the page.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const hash = window.location.hash || '';
      if (pathname === '/privacy' || pathname === '/terms') {
        window.location.href = pathname;
        return;
      }
      // Supabase/Google may redirect to site root with tokens in hash; redirect to callback so it can process and then to /home
      if ((pathname === '/' || pathname === '') && hash.includes('access_token=')) {
        window.location.replace('/auth/callback' + hash);
        return;
      }
    }

    // Track if we've ever had non-empty segments (so we don't redirect on mid-navigation empty segments)
    if (segments && segments.length > 0) {
      hasSeenNonEmptySegments.current = true;
    }

    // If segments is empty on web (Expo Router sometimes has empty segments on initial load),
    // provide a default redirect after a brief delay. Skip redirect when we've already seen
    // non-empty segments (e.g. user tapped Profile -> Edit Profile and segments went empty briefly).
    if (!segments || segments.length === 0) {
      const timeoutId = setTimeout(() => {
        if (!hasSeenNonEmptySegments.current) {
          if (!session && !user) {
            router.replace('/(onboarding)/home');
          } else {
            router.replace('/(tabs)/analyze');
          }
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }

    // Define which route groups don't require auth
    // Include (settings) so privacy/terms pages are accessible without authentication
    const inAuthGroup = segments[0] === '(onboarding)' || segments[0] === 'auth' || segments[0] === '(settings)';
    
    // Exclude reset-password from redirect - it needs a session (from recovery token) but user should stay on screen
    const isResetPassword = segments[0] === 'auth' && segments[1] === 'reset-password';
    
    // Check if user has any auth (session OR user object for unverified users)
    const hasAuth = session || user;

    if (!hasAuth && !inAuthGroup) {
      // User is not signed in and trying to access protected route
      // Redirect to welcome/onboarding
      console.log('AuthGate: No auth, redirecting to home');
      router.replace('/(onboarding)/home');
    } else if (hasAuth && inAuthGroup && !isResetPassword) {
      // User is signed in but on an auth/onboarding screen — redirect to main app
      if (segments[0] === '(onboarding)' || segments[0] === 'auth') {
        console.log('AuthGate: Has auth, on auth/onboarding, redirecting to analyze');
        router.replace('/(tabs)/analyze');
      }
    }
  }, [isInitialized, isLoading, session, user, segments, router]);

  // Hide native splash once we're ready to show content (splash stays up during init)
  useEffect(() => {
    if (isInitialized && !isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isInitialized, isLoading]);

  // Show loading screen while initializing
  if (!isInitialized || isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootContentWithInsets() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screenWrapper,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AuthGate>
            <RootContentWithInsets />
          </AuthGate>
        </QueryClientProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.neutral[900],
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.neutral[700],
    textAlign: 'center',
    marginBottom: 16,
  },
  errorStack: {
    fontSize: 11,
    color: colors.neutral[600],
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 16,
    maxHeight: 200,
  },
  errorHint: {
    fontSize: 12,
    color: colors.neutral[500],
  },
});
