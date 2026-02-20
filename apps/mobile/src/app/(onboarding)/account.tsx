import { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  ScrollView, 
  TouchableOpacity, 
  TextInput, 
  Alert, 
  Platform,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Button, ProgressIndicator, GoogleLogo, AppleLogo } from '../../components';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../lib/supabase';
import { updateProfile } from '../../lib/api';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { API_URL } from '../../lib/apiConfig';

// Auth flow states
type AuthStep = 'email' | 'password';
type AccountStatus = 'unknown' | 'exists' | 'new';

// Feature flags for OAuth
const ENABLE_SOCIAL_AUTH = true;
const ENABLE_APPLE_AUTH = false; // Set true when Apple sign-in is configured

export default function AccountScreen() {
  const router = useRouter();
  const { answers } = useOnboardingStore();
  const { session, setPendingEmailVerification, setSession, setUserPendingVerification } = useAuthStore();
  
  // Flow state
  const [step, setStep] = useState<AuthStep>('email');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('unknown');
  
  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  
  // Refs
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);

  // Focus password input when step changes to password
  useEffect(() => {
    if (step === 'password') {
      setTimeout(() => passwordInputRef.current?.focus(), 100);
    }
  }, [step]);

  // If session appears while we're on this screen (e.g., from deep link OAuth),
  // navigate to main app immediately
  useEffect(() => {
    if (session && isLoading) {
      setIsLoading(false);
      router.replace('/(tabs)/analyze');
    }
  }, [session, isLoading, router]);

  // Check if email exists in database (backend check-email is reliable; Supabase signIn returns same error for new vs wrong password)
  const handleEmailSubmit = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsCheckingEmail(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      let exists = false;

      try {
        const response = await fetch(`${API_URL}/api/auth/check-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail }),
        });
        if (response.ok) {
          const data = await response.json();
          exists = data.exists === true;
        }
      } catch (_) {
        // Network/backend error: default to new so user can try sign up
      }

      setAccountStatus(exists ? 'exists' : 'new');
      setStep('password');
    } catch (err) {
      console.error('Email check error:', err);
      setAccountStatus('new');
      setStep('password');
    } finally {
      setIsCheckingEmail(false);
    }
  };

  // Go back to email step
  const handleBackToEmail = () => {
    setStep('email');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setAccountStatus('unknown');
  };

  // Handle sign in (existing user)
  const handleSignIn = async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        // Check if the error is about email not being confirmed
        const errorMsg = signInError.message.toLowerCase();
        if (errorMsg.includes('email not confirmed') || errorMsg.includes('email_not_confirmed')) {
          setError('Please check your inbox and verify your email to sign in. You can request a new verification email below.');
          setIsLoading(false);
          return;
        }
        throw signInError;
      }

      if (data.session) {
        // Explicitly update auth store
        setSession(data.session);
        
        // Navigation will be handled by root layout auth gate
        // But we could explicitly navigate for better UX
        router.replace('/(tabs)/analyze');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? 
        err.message : 'Sign in failed';
      
      if (errorMessage.toLowerCase().includes('invalid login credentials')) {
        setError('Incorrect password. Please try again.');
      } else if (errorMessage.toLowerCase().includes('email not confirmed') || 
                 errorMessage.toLowerCase().includes('email_not_confirmed')) {
        setError('Please verify your email before signing in. Check your inbox for the verification link.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handle resend verification email for existing unverified users
  const handleResendVerification = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });

      if (error) throw error;

      if (Platform.OS === 'web') {
        window.alert('Verification email sent! Please check your inbox and click the link to verify your account.');
      } else {
        Alert.alert(
          'Email Sent',
          'Verification email sent! Please check your inbox and click the link to verify your account.',
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send verification email';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle sign up (new user)
  const handleSignUp = async () => {
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signUpError) {
        // Check if user already exists (race condition or email check was wrong)
        if (signUpError.message.toLowerCase().includes('already registered') ||
            signUpError.message.toLowerCase().includes('already exists')) {
          setAccountStatus('exists');
          setConfirmPassword('');
          setError('This email is already registered. Please sign in instead.');
          return;
        }
        throw signUpError;
      }

      if (data.user) {
        // Check if email confirmation is required
        const needsEmailVerification = !data.user.email_confirmed_at;
        
        if (needsEmailVerification) {
          setPendingEmailVerification(true);
        }

        // Save onboarding preferences to profile
        try {
          await updateProfile({
            tradingStyle: answers.tradingStyle,
            experienceLevel: answers.experienceLevel,
          });
        } catch (profileError) {
          console.warn('Failed to save profile preferences:', profileError);
          // Don't block auth flow for profile save failure
        }

        // Explicitly update auth store: session when available, else user pending verification
        if (data.session) {
          setSession(data.session);
        } else if (data.user) {
          setUserPendingVerification(data.user);
        }

        // Success notification: user sees confirmation before being taken to the app
        // Alert.alert does not work on web (RN/Expo); use window.alert then navigate
        const message = needsEmailVerification
          ? 'Welcome to ChartSignl! Please check your email to verify your account.'
          : 'Welcome to ChartSignl! Your account has been created successfully.';
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert('Account Created! 🎉\n\n' + message);
          router.replace('/(tabs)/analyze');
        } else {
          Alert.alert(
            'Account Created! 🎉',
            message,
            [
              {
                text: 'Get Started',
                onPress: () => router.replace('/(tabs)/analyze'),
              },
            ]
          );
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? 
        err.message : 'Sign up failed';

      // Handle email configuration issues
      if (errorMessage.includes('confirmation email') || errorMessage.includes('Error sending')) {
        if (Platform.OS !== 'web') {
          Alert.alert(
            'Email Configuration Error',
            'Email verification is not configured. Please contact support.',
            [{ text: 'OK' }]
          );
        }
        setError('Email service unavailable. Please try again later.');
        return;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle social auth (Google/Apple)
  // On native we listen for the deep link on this screen (Expo Router doesn't navigate to /auth/callback on Android onNewIntent).
  const handleSocialAuth = async (provider: 'google' | 'apple') => {
    setIsLoading(true);
    setError(null);

    try {
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'chartsignl',
        path: 'auth/callback',
      });

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const webRedirect = `${window.location.origin}/auth/callback`;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: webRedirect, skipBrowserRedirect: false },
        });
        if (error) throw error;
        if (data?.url) window.location.href = data.url;
        return;
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');

      // Set up deep link listener BEFORE opening browser (catches callback when app is brought to front)
      const tokenPromise = new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 120000);

        const sub = Linking.addEventListener('url', (event: { url: string }) => {
          if (event.url.includes('auth/callback') || event.url.includes('access_token')) {
            clearTimeout(timeout);
            sub.remove();
            resolve(event.url);
          }
        });

        Linking.getInitialURL().then((url) => {
          if (url && (url.includes('auth/callback') || url.includes('access_token'))) {
            clearTimeout(timeout);
            sub.remove();
            resolve(url);
          }
        });
      });

      void WebBrowser.openBrowserAsync(data.url, { showInRecents: true });

      const callbackUrl = await tokenPromise;

      if (!callbackUrl) {
        setIsLoading(false);
        return;
      }

      // Parse tokens from the callback URL
      const hashStart = callbackUrl.indexOf('#');
      const queryStart = callbackUrl.indexOf('?');
      const hashPart = hashStart >= 0 ? callbackUrl.slice(hashStart + 1) : '';
      const queryPart =
        queryStart >= 0 && (hashStart < 0 || queryStart < hashStart)
          ? callbackUrl.slice(queryStart + 1).split('#')[0]
          : '';

      let accessToken: string | null = null;
      let refreshToken: string | null = null;

      if (hashPart) {
        const p = new URLSearchParams(hashPart);
        accessToken = p.get('access_token');
        refreshToken = p.get('refresh_token');
      }
      if (!accessToken && queryPart) {
        const p = new URLSearchParams(queryPart);
        accessToken = p.get('access_token');
        refreshToken = p.get('refresh_token');
      }

      if (!accessToken) {
        throw new Error('No access token found in callback');
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });
      if (sessionError) throw sessionError;

      await new Promise((r) => setTimeout(r, 300));

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setSession(session);

        if (answers.tradingStyle) {
          try {
            await updateProfile({
              tradingStyle: answers.tradingStyle,
              experienceLevel: answers.experienceLevel,
            });
          } catch (e) {
            console.warn('Failed to save onboarding preferences:', e);
          }
        }

        void WebBrowser.dismissBrowser();

        router.replace('/(tabs)/analyze');
      } else {
        throw new Error('Session not established');
      }
    } catch (err) {
      let errorMessage = 'Authentication failed';
      if (err instanceof Error) {
        if (err.message.includes('Provider not enabled')) {
          errorMessage = `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured yet.`;
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };


  // Render email step
  const renderEmailStep = () => (
    <>
      <Text style={styles.title}>Welcome to ChartSignl</Text>
      <Text style={styles.subtitle}>
        Enter your email to sign in or create an account
      </Text>

      {/* Email Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.neutral[400]}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="next"
          onSubmitEditing={handleEmailSubmit}
          editable={!isCheckingEmail}
        />
      </View>

      {/* Error Message */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Continue Button */}
      <Button
        title={isCheckingEmail ? 'Checking...' : 'Continue'}
        onPress={handleEmailSubmit}
        disabled={isCheckingEmail || !email.trim()}
        style={styles.primaryButton}
      />

      {ENABLE_SOCIAL_AUTH && (
        <>
          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Auth Buttons */}
          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialAuth('google')}
              disabled={isLoading}
            >
              <GoogleLogo size={18} />
              <Text style={styles.socialButtonText}>Google</Text>
            </TouchableOpacity>
            {ENABLE_APPLE_AUTH && (
              <TouchableOpacity
                style={styles.socialButton}
                onPress={() => handleSocialAuth('apple')}
                disabled={isLoading}
              >
                <AppleLogo size={18} />
                <Text style={styles.socialButtonText}>Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </>
  );

  // Render password step (existing user - sign in)
  const renderSignInStep = () => (
    <>
      <TouchableOpacity onPress={handleBackToEmail} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Welcome back!</Text>
      <Text style={styles.subtitle}>
        Enter your password to sign in as{'\n'}
        <Text style={styles.emailHighlight}>{email}</Text>
      </Text>

      {/* Password Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Password</Text>
        <TextInput
          ref={passwordInputRef}
          style={styles.input}
          placeholder="Enter your password"
          placeholderTextColor={colors.neutral[400]}
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
          editable={!isLoading}
        />
      </View>

      {/* Forgot Password */}
      <TouchableOpacity onPress={() => router.push('/(onboarding)/forgot-password')} disabled={isLoading}>
        <Text style={styles.forgotPassword}>Forgot password?</Text>
      </TouchableOpacity>

      {/* Error Message with optional resend verification link */}
      {error && (
        <View>
          <Text style={styles.errorText}>{error}</Text>
          {(error.toLowerCase().includes('verify') || error.toLowerCase().includes('verification')) && (
            <TouchableOpacity 
              onPress={handleResendVerification} 
              disabled={isLoading}
              style={styles.resendButton}
            >
              <Text style={styles.resendButtonText}>
                Resend verification email
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Sign In Button */}
      <Button
        title={isLoading ? 'Signing in...' : 'Sign In'}
        onPress={handleSignIn}
        disabled={isLoading || !password.trim()}
        style={styles.primaryButton}
      />

      {ENABLE_SOCIAL_AUTH && (
        <>
          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Auth Buttons */}
          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialAuth('google')}
              disabled={isLoading}
            >
              <GoogleLogo size={18} />
              <Text style={styles.socialButtonText}>Google</Text>
            </TouchableOpacity>
            {ENABLE_APPLE_AUTH && (
              <TouchableOpacity
                style={styles.socialButton}
                onPress={() => handleSocialAuth('apple')}
                disabled={isLoading}
              >
                <AppleLogo size={18} />
                <Text style={styles.socialButtonText}>Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </>
  );

  // Render password step (new user - sign up)
  const renderSignUpStep = () => (
    <>
      <TouchableOpacity onPress={handleBackToEmail} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>
        Set a password for{'\n'}
        <Text style={styles.emailHighlight}>{email}</Text>
      </Text>

      {/* Password Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Password</Text>
        <TextInput
          ref={passwordInputRef}
          style={styles.input}
          placeholder="Create a password (min 8 characters)"
          placeholderTextColor={colors.neutral[400]}
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          returnKeyType="next"
          onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
          editable={!isLoading}
        />
      </View>

      {/* Confirm Password Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Confirm Password</Text>
        <TextInput
          ref={confirmPasswordInputRef}
          style={styles.input}
          placeholder="Re-enter your password"
          placeholderTextColor={colors.neutral[400]}
          value={confirmPassword}
          onChangeText={(text) => {
            setConfirmPassword(text);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          returnKeyType="done"
          onSubmitEditing={handleSignUp}
          editable={!isLoading}
        />
      </View>

      {/* Error Message */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Create Account Button */}
      <Button
        title={isLoading ? 'Creating account...' : 'Create Account'}
        onPress={handleSignUp}
        disabled={isLoading || !password.trim() || !confirmPassword.trim()}
        style={styles.primaryButton}
      />

      {ENABLE_SOCIAL_AUTH && (
        <>
          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Auth Buttons */}
          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialAuth('google')}
              disabled={isLoading}
            >
              <GoogleLogo size={18} />
              <Text style={styles.socialButtonText}>Google</Text>
            </TouchableOpacity>
            {ENABLE_APPLE_AUTH && (
              <TouchableOpacity
                style={styles.socialButton}
                onPress={() => handleSocialAuth('apple')}
                disabled={isLoading}
              >
                <AppleLogo size={18} />
                <Text style={styles.socialButtonText}>Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {/* Terms */}
      <Text style={styles.termsText}>
        By creating an account, you agree to our{' '}
        <Text style={styles.termsLink} onPress={() => router.push('/(settings)/terms')}>
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          style={styles.termsLink}
          onPress={() => {
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
              window.location.href = '/privacy';
            } else {
              Linking.openURL('https://chartsignl.com/privacy');
            }
          }}
        >
          Privacy Policy
        </Text>
      </Text>
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            <ScrollView 
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Progress Indicator */}
              <View style={styles.progressContainer}>
                <ProgressIndicator current={4} total={4} />
              </View>

              {/* Content */}
              <View style={styles.content}>
                {step === 'email' && renderEmailStep()}
                {step === 'password' && accountStatus === 'exists' && renderSignInStep()}
                {step === 'password' && accountStatus === 'new' && renderSignUpStep()}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 480;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' && { alignItems: 'center' }),
  },
  webInner: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' && { maxWidth: WEB_MAX_WIDTH }),
  },
  keyboardView: {
    flex: 1,
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
  progressContainer: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  content: {
    flex: 1,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  backButtonText: {
    ...typography.bodyMd,
    color: colors.primary[600],
    fontWeight: '600',
  },
  title: {
    ...typography.displayMd,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyLg,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  emailHighlight: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  inputContainer: {
    marginBottom: spacing.sm,
  },
  inputLabel: {
    ...typography.labelMd,
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.bodyMd,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.neutral[900],
  },
  forgotPassword: {
    ...typography.bodyMd,
    color: colors.primary[600],
    textAlign: 'right',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.bodySm,
    color: colors.error,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  resendButton: {
    marginBottom: spacing.sm,
  },
  resendButtonText: {
    ...typography.bodySm,
    color: colors.primary[600],
    textDecorationLine: 'underline',
  },
  primaryButton: {
    marginTop: spacing.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.neutral[200],
  },
  dividerText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginHorizontal: spacing.md,
  },
  socialButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  socialButtonText: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    fontWeight: '600',
  },
  termsText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  termsLink: {
    color: colors.primary[600],
    textDecorationLine: 'underline',
  },
});
