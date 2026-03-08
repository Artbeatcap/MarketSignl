import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, Input } from '../../components';
import { supabase } from '../../lib/supabase';
import { colors, typography, spacing, borderRadius } from '../../theme';

// User has an email+password identity (can change password). OAuth-only users set password instead.
function hasEmailPasswordIdentity(identities: Array<{ provider: string }> | undefined): boolean {
  return !!identities?.some((i) => i.provider === 'email');
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOAuthOnly, setIsOAuthOnly] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) {
        if (!user) setIsOAuthOnly(false);
        return;
      }
      const identities = (user as { identities?: Array<{ provider: string }> }).identities ?? [];
      // Only treat as OAuth-only if we have identities and none is email (default to change-password if unknown)
      setIsOAuthOnly(identities.length > 0 && !hasEmailPasswordIdentity(identities));
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSetPassword = async () => {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Error', 'Please enter and confirm your password');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      Alert.alert(
        'Password set',
        'You can now sign in with your email and this password as well as with Google.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Set password error:', err);
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to set password. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async () => {
    // Validation
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    if (currentPassword === newPassword) {
      Alert.alert('Error', 'New password must be different from current password');
      return;
    }

    setIsLoading(true);

    try {
      // First verify current password by attempting to sign in
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        throw new Error('No user session found');
      }

      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        throw new Error('Current password is incorrect');
      }

      // Update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      Alert.alert(
        'Success',
        'Your password has been changed successfully.',
        [{ text: 'OK', onPress: () => router.back() }]
      );

      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Change password error:', err);
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to change password. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isOAuthOnly === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // OAuth-only (e.g. signed up with Google): set a password so they can also sign in with email
  if (isOAuthOnly) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Set a password</Text>
              <Text style={styles.description}>
                Add a password to sign in with email too. You can use either Google or email + password.
              </Text>
            </View>
            <View style={styles.form}>
              <Input
                label="New Password"
                placeholder="Choose a password (min 8 characters)"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="next"
              />
              <Input
                label="Confirm Password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                containerStyle={{ marginTop: spacing.md }}
                returnKeyType="go"
                onSubmitEditing={handleSetPassword}
              />
              <View style={styles.requirementsBox}>
                <Text style={styles.requirementsTitle}>Password must:</Text>
                <Text style={[styles.requirement, newPassword.length >= 8 && styles.requirementMet]}>
                  {newPassword.length >= 8 ? '✓' : '○'} Be at least 8 characters long
                </Text>
                <Text style={[styles.requirement, newPassword === confirmPassword && newPassword.length > 0 && styles.requirementMet]}>
                  {newPassword === confirmPassword && newPassword.length > 0 ? '✓' : '○'} Passwords match
                </Text>
              </View>
              <Button
                title="Set Password"
                onPress={handleSetPassword}
                size="lg"
                fullWidth
                loading={isLoading}
                style={{ marginTop: spacing.xl }}
                disabled={!newPassword || !confirmPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              />
            </View>
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
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Change Password</Text>
            <Text style={styles.description}>
              Keep your account secure by using a strong, unique password.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Current Password"
              placeholder="Enter current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="next"
            />

            <View style={styles.divider} />

            <Input
              label="New Password"
              placeholder="Enter new password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="next"
            />

            <Input
              label="Confirm New Password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              containerStyle={{ marginTop: spacing.md }}
              returnKeyType="go"
              onSubmitEditing={handleChangePassword}
            />

            {/* Password Requirements */}
            <View style={styles.requirementsBox}>
              <Text style={styles.requirementsTitle}>New password must:</Text>
              <Text style={[
                styles.requirement,
                newPassword.length >= 8 && styles.requirementMet,
              ]}>
                {newPassword.length >= 8 ? '✓' : '○'} Be at least 8 characters long
              </Text>
              <Text style={[
                styles.requirement,
                newPassword !== currentPassword && newPassword.length > 0 && styles.requirementMet,
              ]}>
                {newPassword !== currentPassword && newPassword.length > 0 ? '✓' : '○'} Be different from current password
              </Text>
              <Text style={[
                styles.requirement,
                newPassword === confirmPassword && newPassword.length > 0 && styles.requirementMet,
              ]}>
                {newPassword === confirmPassword && newPassword.length > 0 ? '✓' : '○'} Passwords match
              </Text>
            </View>

            <Button
              title="Change Password"
              onPress={handleChangePassword}
              size="lg"
              fullWidth
              loading={isLoading}
              style={{ marginTop: spacing.xl }}
              disabled={
                !currentPassword ||
                !newPassword ||
                !confirmPassword ||
                newPassword !== confirmPassword ||
                newPassword.length < 8 ||
                newPassword === currentPassword
              }
            />
          </View>

          {/* Security Tips */}
          <View style={styles.tipsBox}>
            <Text style={styles.tipsTitle}>💡 Security Tips</Text>
            <Text style={styles.tipText}>• Use a mix of letters, numbers, and symbols</Text>
            <Text style={styles.tipText}>• Avoid using personal information</Text>
            <Text style={styles.tipText}>• Don't reuse passwords from other accounts</Text>
            <Text style={styles.tipText}>• Consider using a password manager</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    marginTop: spacing.md,
  },
  header: {
    marginBottom: spacing.xl,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
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
  },
  description: {
    ...typography.bodyMd,
    color: colors.neutral[600],
  },
  form: {
    marginTop: spacing.xl,
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral[200],
    marginVertical: spacing.xl,
  },
  requirementsBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.md,
  },
  requirementsTitle: {
    ...typography.labelMd,
    fontWeight: '600',
    color: colors.neutral[700],
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
  tipsBox: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary[100],
  },
  tipsTitle: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  tipText: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
