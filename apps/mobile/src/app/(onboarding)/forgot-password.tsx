import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, Input } from '../../components';
import { supabase } from '../../lib/supabase';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleResetRequest = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    // Use platform-specific redirect URL logic
    let redirectTo;
    
    if (Platform.OS === 'web') {
      // For web, use the current origin or production URL
      if (typeof window !== 'undefined') {
        // If in development (localhost), use localhost
        // If in production, use production URL
        redirectTo = window.location.origin.includes('localhost')
          ? `${window.location.origin}/auth/reset-password`
          : 'https://chartsignl.com/auth/reset-password';
      } else {
        redirectTo = 'https://chartsignl.com/auth/reset-password';
      }
    } else {
      // For mobile (iOS/Android), use deep link
      redirectTo = 'chartsignl://auth/reset-password';
    }

    try {
      const { error, data } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo,
      });

      if (error) {
        throw error;
      }

      setEmailSent(true);
    } catch (err) {
      // Provide more helpful error message (similar to account.tsx handling)
      let errorMessage = 'Failed to send reset email. Please try again.';
      let errorTitle = 'Error';
      
      if (err instanceof Error) {
        const errorLower = err.message.toLowerCase();
        
        // Check for common Supabase email configuration errors
        if (errorLower.includes('error sending') || 
            errorLower.includes('recovery email')) {
          errorTitle = 'Email Configuration Required';
          errorMessage = `Supabase email service is not configured.\n\nTo fix:\n1. Go to Supabase Dashboard > Authentication > URL Configuration\n2. Add redirect URL: ${redirectTo}\n3. Go to Authentication > Settings > Email Auth\n4. Configure SMTP settings OR add your email to authorized recipients (for development)\n\nSee: https://supabase.com/docs/guides/auth/auth-smtp`;
        } else if (errorLower.includes('user not found') || errorLower.includes('email not found')) {
          errorTitle = 'Google sign-in user';
          errorMessage = 'This account uses Google sign-in. To set a password: sign in with Google, then go to Profile → Change password to add a password so you can sign in with email too.';
        } else {
          // For other errors, show the original message
          errorMessage = err.message;
        }
      }
      
      // Only log non-configuration errors to reduce console noise
      if (errorTitle === 'Error') {
        console.error('Password reset error:', err);
      }
      
      Alert.alert(errorTitle, errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            {/* Success Icon */}
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>

            {/* Success Message */}
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.description}>
              We've sent a password reset link to{'\n'}
              <Text style={styles.emailText}>{email}</Text>
            </Text>

            <Text style={styles.instructions}>
              Click the link in the email to reset your password. The link will expire in 1 hour.
            </Text>

            <View style={styles.helpBox}>
              <Text style={styles.helpText}>
                Signed up with Google? We sent the link to this email so you can set a password. Check your inbox and spam folder.
              </Text>
            </View>

            {/* Actions */}
            <Button
              title="Back to Sign In"
              onPress={() => router.back()}
              size="lg"
              fullWidth
              style={{ marginTop: spacing.xl }}
            />

            <TouchableOpacity
              onPress={() => setEmailSent(false)}
              style={styles.resendButton}
            >
              <Text style={styles.resendText}>Didn't receive the email? Send again</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.description}>
            Enter your email address and we'll send you a link to reset your password.
          </Text>
          <View style={styles.helpBox}>
            <Text style={styles.helpText}>
              Signed up with Google? You can set a password for this email so you can sign in with email too.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={handleResetRequest}
            />

            <Button
              title="Send Reset Link"
              onPress={handleResetRequest}
              size="lg"
              fullWidth
              loading={isLoading}
              style={{ marginTop: spacing.lg }}
            />
          </View>

          {/* Help Text */}
          <View style={styles.helpBox}>
            <Text style={styles.helpText}>
              💡 Remember your password?{' '}
              <Text style={styles.helpLink} onPress={() => router.back()}>
                Sign in here
              </Text>
            </Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  content: {
    flex: 1,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.xl,
  },
  backButtonText: {
    ...typography.bodyMd,
    color: colors.primary[600],
    fontWeight: '600',
  },
  title: {
    ...typography.displayMd,
    color: colors.neutral[900],
    marginBottom: spacing.sm,
    textAlign: 'center',
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
  helpBox: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary[100],
  },
  helpText: {
    ...typography.bodySm,
    color: colors.neutral[600],
    textAlign: 'center',
  },
  helpLink: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  successIconText: {
    fontSize: 40,
    color: colors.primary[600],
    fontWeight: 'bold',
  },
  emailText: {
    fontWeight: '600',
    color: colors.neutral[900],
  },
  instructions: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 24,
  },
  resendButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  resendText: {
    ...typography.bodyMd,
    color: colors.primary[600],
    textAlign: 'center',
    fontWeight: '600',
  },
});
