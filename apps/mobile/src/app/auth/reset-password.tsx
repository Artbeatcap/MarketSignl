import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button, Input } from '../../components';
import { supabase } from '../../lib/supabase';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Restore success from URL so confirmation survives remount/redirect (important for Google users after updateUser)
  const urlSuccess =
    (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hash?.includes('password-reset-success')) ||
    params?.success === '1' ||
    params?.success === true;
  const [resetSuccess, setResetSuccess] = useState(() => !!urlSuccess);
  const validationStartedRef = useRef(false);

  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  };

  useEffect(() => {
    // Run validation only once on mount to avoid repeated effect runs leaving UI stuck on "Validating..."
    if (validationStartedRef.current) return;
    validationStartedRef.current = true;
    validateResetToken();
  }, []);

  const validateResetToken = async () => {
    setIsValidating(true);

    try {
      // Try to extract tokens from params
      let accessToken: string | null = null;
      let refreshToken: string | null = null;
      let tokenType: string | null = null;

      // Check if we have tokens in params or URL
      if (params) {
        try {
          // Try extracting from URL fragment first (for deep links)
          if (params.url) {
            const url = params.url as string;
            const query = url.split('?')[1].split('#')[0];
            const queryParams = new URLSearchParams(query);
            accessToken = queryParams.get('access_token');
            refreshToken = queryParams.get('refresh_token');
            tokenType = queryParams.get('type');
          }

          // Also check params directly
          if (!accessToken) {
            accessToken = params.access_token as string | null;
            refreshToken = params.refresh_token as string | null;
            tokenType = params.type as string | null;
          }
        } catch (e) {
          // Ignore extraction errors
        }
      }

      // On web, tokens are often in the URL hash (Supabase redirect); useLocalSearchParams doesn't include hash
      if (!accessToken && Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hash) {
        try {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          accessToken = hashParams.get('access_token');
          refreshToken = hashParams.get('refresh_token');
          tokenType = hashParams.get('type');
        } catch (e) {
          // Ignore hash parse errors
        }
      }

      // If we have tokens, set the session first
      if (accessToken) {
        const { error: sessionError, data: sessionData } = await withTimeout(
          supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          }),
          10000,
          'setSession'
        );

        if (sessionError) {
          throw sessionError;
        }

        if (sessionData?.session) {
          setIsValid(true);
          setIsValidating(false);
          return;
        }
      }

      // Fallback: try getSession (in case Supabase auto-processed the URL)
      const { data: { session }, error } = await withTimeout(
        supabase.auth.getSession(),
        10000,
        'getSession'
      );

      if (error || !session) {
        setIsValid(false);
        Alert.alert(
          'Invalid Link',
          'This password reset link is invalid or has expired. Please request a new one.\n\nSigned up with Google? Use "Sign in with Google" on the sign-in page instead.',
          [{ text: 'OK', onPress: () => router.replace('/(onboarding)/forgot-password') }]
        );
      } else {
        setIsValid(true);
      }
    } catch (err) {
      console.error('Token validation error:', err);
      setIsValid(false);
      Alert.alert(
        'Invalid Link',
        'This password reset link is invalid or has expired. Please request a new one.\n\nSigned up with Google? Use "Sign in with Google" on the sign-in page instead.',
        [{ text: 'OK', onPress: () => router.replace('/(onboarding)/forgot-password') }]
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleResetPassword = async () => {
    // Clear previous error
    setErrorMessage(null);

    // Validation
    if (!password.trim() || !confirmPassword.trim()) {
      setErrorMessage('Please enter and confirm your new password');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      // Show on-screen success: set URL first so confirmation survives remount (e.g. Google users + auth state update)
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.hash = 'password-reset-success';
        const url = new URL(window.location.href);
        url.searchParams.set('success', '1');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      setResetSuccess(true);
      Alert.alert(
        'Password changed',
        'Your password has been updated. You can now sign in with your new password.',
        [{ text: 'OK' }]
      );
    } catch (err) {
      console.error('Password reset error:', err);
      const errMsg = err instanceof Error ? err.message : 'Failed to reset password. Please try again.';
      setErrorMessage(errMsg);
      Alert.alert('Error', errMsg);
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Validating reset link...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isValid) {
    return null; // Alert will handle navigation
  }

  if (resetSuccess || urlSuccess) {
    return (
      <SafeAreaView style={[styles.container, Platform.OS === 'web' && styles.containerWeb]}>
        <View style={styles.successBanner}>
          <Text style={styles.successBannerText}>✓ Password changed successfully</Text>
        </View>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Text style={styles.successIconText}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Password reset successful</Text>
          <View style={styles.successMessageBox}>
            <Text style={styles.successMessage}>
              Your password has been changed. You can now sign in with your new password.
            </Text>
          </View>
          <Button
            title="Go to Sign In"
            onPress={() => router.replace('/(onboarding)/account')}
            size="lg"
            style={styles.successButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔒</Text>
          </View>
          
          <Text style={styles.title}>Create new password</Text>
          <Text style={styles.description}>
            Your new password must be different from your previous password.
          </Text>

          {/* Form */}
          <View style={styles.form}>
            {errorMessage && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
            <Input
              label="New Password"
              placeholder="Enter new password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="next"
            />

            <Input
              label="Confirm Password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              containerStyle={{ marginTop: spacing.md }}
              returnKeyType="go"
              onSubmitEditing={handleResetPassword}
            />

            {/* Password Requirements */}
            <View style={styles.requirementsBox}>
              <Text style={styles.requirementsTitle}>Password must:</Text>
              <Text style={[
                styles.requirement,
                password.length >= 8 && styles.requirementMet,
              ]}>
                {password.length >= 8 ? '✓' : '○'} Be at least 8 characters long
              </Text>
              <Text style={[
                styles.requirement,
                password === confirmPassword && password.length > 0 && styles.requirementMet,
              ]}>
                {password === confirmPassword && password.length > 0 ? '✓' : '○'} Passwords match
              </Text>
            </View>

            <Button
              title="Reset Password"
              onPress={handleResetPassword}
              size="lg"
              fullWidth
              loading={isLoading}
              disabled={
                isLoading || 
                password.length < 8 || 
                password !== confirmPassword ||
                !password.trim() ||
                !confirmPassword.trim()
              }
              style={{ marginTop: spacing.lg }}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerWeb: {
    minHeight: '100vh' as unknown as number,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodyLg,
    color: colors.neutral[600],
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  successBanner: {
    width: '100%',
    backgroundColor: colors.green?.[600] ?? colors.primary[600],
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBannerText: {
    ...typography.labelLg,
    color: '#fff',
    fontWeight: '600',
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.green?.[100] ?? colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  successIconText: {
    fontSize: 40,
    color: colors.green?.[600] ?? colors.primary[600],
    fontWeight: 'bold',
  },
  successTitle: {
    ...typography.displayMd,
    color: colors.neutral[900],
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  successMessageBox: {
    backgroundColor: colors.green?.[50] ?? colors.primary[50],
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xl,
    maxWidth: 360,
  },
  successMessage: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    textAlign: 'center',
  },
  successButton: {
    marginTop: spacing.md,
    minWidth: 200,
  },
  content: {
    flex: 1,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing.xxl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    ...typography.displayMd,
    color: colors.neutral[900],
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  form: {
    marginTop: spacing.xl,
  },
  errorBanner: {
    backgroundColor: colors.red?.[50] ?? '#FEE',
    borderWidth: 1,
    borderColor: colors.red?.[200] ?? '#FCC',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySm,
    color: colors.red?.[700] ?? '#C00',
    textAlign: 'center',
  },
  requirementsBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.md,
  },
  requirementsTitle: {
    ...typography.labelMd,
    color: colors.neutral[700],
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  requirement: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  requirementMet: {
    color: colors.primary[600],
    fontWeight: '500',
  },
});
