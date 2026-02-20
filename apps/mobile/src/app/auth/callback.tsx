import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';
import { supabase } from '../../lib/supabase';
import { getCurrentUser, updateProfile } from '../../lib/api';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useAuthStore } from '../../store/authStore';
import { colors, typography, spacing } from '../../theme';
import { Button } from '../../components';

/**
 * Auth Callback Handler
 * 
 * This screen handles OAuth redirects and email verification callbacks.
 * It extracts tokens from the URL, completes the Supabase session, and navigates
 * to the appropriate screen.
 * 
 * Handles:
 * - OAuth callbacks (Google, Apple sign-in)
 * - Email verification links
 * - Password reset links
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { answers } = useOnboardingStore();
  const { setSession, checkEmailVerification, refreshSession } = useAuthStore();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let subscription: ReturnType<typeof Linking.addEventListener> | null = null;
    
    const parseTokensFromUrl = (url: string): { accessToken: string | null; refreshToken: string | null; type: string | null } => {
        const hashStart = url.indexOf('#');
        const queryStart = url.indexOf('?');
        const hashPart = hashStart >= 0 ? url.slice(hashStart + 1) : '';
        const queryPart = queryStart >= 0 && (hashStart < 0 || queryStart < hashStart) ? url.slice(queryStart + 1).split('#')[0] : '';
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        let type: string | null = null;
        if (hashPart) {
          const p = new URLSearchParams(hashPart);
          accessToken = p.get('access_token');
          refreshToken = p.get('refresh_token');
          type = p.get('type');
        }
        if (!accessToken && queryPart) {
          const p = new URLSearchParams(queryPart);
          accessToken = p.get('access_token');
          refreshToken = p.get('refresh_token');
          if (!type) type = p.get('type');
        }
        return { accessToken, refreshToken, type };
      };

    const handleCallback = async (deepLinkUrl?: string) => {
      try {
        // Detect callback type and get tokens (detectSessionInUrl is false, so we set session ourselves)
        let callbackType: 'oauth' | 'email_verification' | 'recovery' | 'unknown' = 'unknown';
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        // Prefer URL from deep link event (mobile) or current page (web)
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const hash = window.location.hash.substring(1);
          if (hash) {
            const p = new URLSearchParams(hash);
            accessToken = p.get('access_token');
            refreshToken = p.get('refresh_token');
            const type = p.get('type');
            if (type === 'signup' || type === 'email_change') {
              callbackType = 'email_verification';
              setMessage('Verifying your email...');
            } else if (type === 'recovery') {
              callbackType = 'recovery';
              setMessage('Processing password reset...');
            } else if (accessToken) {
              callbackType = 'oauth';
              setMessage('Completing sign in...');
            }
          }
        } else if (deepLinkUrl) {
          const parsed = parseTokensFromUrl(deepLinkUrl);
          accessToken = parsed.accessToken;
          refreshToken = parsed.refreshToken;
          const type = parsed.type;
          if (type === 'recovery') callbackType = 'recovery';
          else if (type === 'signup' || type === 'email_change') callbackType = 'email_verification';
          else if (accessToken) callbackType = 'oauth';
          if (callbackType === 'oauth') setMessage('Completing sign in...');
        } else {
          const url = await Linking.getInitialURL();
          if (url) {
            const parsed = parseTokensFromUrl(url);
            accessToken = parsed.accessToken;
            refreshToken = parsed.refreshToken;
            const type = parsed.type;
            if (type === 'recovery') callbackType = 'recovery';
            else if (type === 'signup' || type === 'email_change') callbackType = 'email_verification';
            else if (accessToken) callbackType = 'oauth';
            if (callbackType === 'oauth') setMessage('Completing sign in...');
          }
        }

        // Fallback: route params (Expo may pass tokens)
        if (!accessToken && params) {
          accessToken = (params.access_token as string) ?? null;
          refreshToken = (params.refresh_token as string) ?? null;
          const type = params.type as string;
          if (type === 'recovery') callbackType = 'recovery';
          else if (type === 'signup' || type === 'email_change') callbackType = 'email_verification';
          else if (accessToken) callbackType = 'oauth';
        }

        if (callbackType === 'oauth') setMessage('Completing sign in...');

        // Set session from URL tokens (required when detectSessionInUrl is false)
        if (accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });
          if (sessionError) {
            console.error('Callback setSession error:', sessionError);
            throw sessionError;
          }
        }

        // Brief wait for storage to persist
        await new Promise(resolve => setTimeout(resolve, 300));

        // Get the session (now set from URL tokens)
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Auth callback error:', error);
          throw error;
        }

        if (session) {
          // Update auth store with the session
          setSession(session);
          
          // Wait for state to propagate (and for storage to persist, especially for OAuth/recovery)
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Handle based on callback type
          if (callbackType === 'email_verification') {
            // Check if email is now verified
            const isVerified = !!session.user?.email_confirmed_at;
            
            if (isVerified) {
              setStatus('success');
              setMessage('Email verified successfully!');
              
              setTimeout(() => {
                router.replace('/(onboarding)/home');
              }, 1500);
              return;
            }
          } else if (callbackType === 'recovery') {
            // For password recovery, give storage time to persist (helps Google/OAuth users)
            await new Promise(resolve => setTimeout(resolve, 200));
            router.replace('/auth/reset-password');
            return;
          }
          
          // For OAuth or general callbacks
          // Check if user has an existing profile
          let hasProfile = false;
          try {
            const profileData = await getCurrentUser();
            hasProfile = !!profileData?.user?.displayName;
          } catch (e) {
            console.log('No profile found, user may be new');
          }

          // Save onboarding answers if available and user is new
          if (!hasProfile && answers.tradingStyle) {
            try {
              await updateProfile({
                tradingStyle: answers.tradingStyle,
                experienceLevel: answers.experienceLevel,
              });
            } catch (e) {
              console.warn('Failed to save onboarding preferences:', e);
            }
          }

          setStatus('success');
          setMessage('Success!');
          // Navigate immediately (AuthGate will redirect authenticated users to main app)
          router.replace('/(tabs)/analyze');
        } else {
          // No session found - might be an invalid or expired link
          setErrorMessage('The link may have expired or is invalid. Please try again.');
          setStatus('error');
        }
      } catch (error) {
        console.error('Callback error:', error);
        setErrorMessage(error instanceof Error ? error.message : 'Authentication failed');
        setStatus('error');
      }
    };

    // Handle deep link on mobile (browser redirects back with tokens in URL)
    const handleDeepLink = async (event: { url: string }) => {
      console.log('Deep link received:', event.url);
      await handleCallback(event.url);
    };

    // Set up deep link listener for mobile
    if (Platform.OS !== 'web') {
      subscription = Linking.addEventListener('url', handleDeepLink);
    }

    // Process the callback (on web uses window.location; on mobile uses getInitialURL() or deep link event)
    handleCallback();

    return () => {
      subscription?.remove();
    };
  }, []);

  const handleContinue = () => {
    router.replace('/(onboarding)/home');
  };

  const handleSignIn = () => {
    router.replace('/(onboarding)/account');
  };

  if (status === 'processing') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text style={styles.processingText}>{message}</Text>
      </View>
    );
  }

  if (status === 'success') {
    return (
      <View style={styles.container}>
        <View style={styles.successIcon}>
          <Text style={styles.successIconText}>✓</Text>
        </View>
        <Text style={styles.title}>{message}</Text>
        <Text style={styles.description}>
          Redirecting you to the app...
        </Text>
      </View>
    );
  }

  // Error state
  return (
    <View style={styles.container}>
      <View style={styles.errorIcon}>
        <Text style={styles.errorIconText}>!</Text>
      </View>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.description}>
        {errorMessage || 'There was an issue processing your request.'}
      </Text>
      <Button
        title="Sign In"
        onPress={handleSignIn}
        size="lg"
        style={styles.button}
      />
      <Button
        title="Continue Anyway"
        onPress={handleContinue}
        variant="outline"
        size="lg"
        style={styles.secondaryButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  processingText: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.green[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  successIconText: {
    fontSize: 40,
    color: colors.green[600],
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.red[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  errorIconText: {
    fontSize: 40,
    color: colors.red[600],
    fontWeight: 'bold',
  },
  title: {
    ...typography.headingLg,
    color: colors.neutral[900],
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  description: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  button: {
    minWidth: 200,
  },
  secondaryButton: {
    minWidth: 200,
    marginTop: spacing.md,
  },
});
