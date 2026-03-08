import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button, EmailVerificationBanner } from '../../components';
import { useAuthStore } from '../../store/authStore';
import { getCurrentUser, getUsage } from '../../lib/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { FREE_ANALYSIS_LIMIT, TRADING_STYLE_OPTIONS } from '@chartsignl/core';
import { useEffect, useCallback, useState } from 'react';
import { API_URL } from '../../lib/apiConfig';

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, signOut, isPremium, checkSubscriptionStatus, isEmailVerified, refreshSubscription, checkEmailVerification } = useAuthStore();

  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: getCurrentUser,
  });

  const { data: usageData } = useQuery({
    queryKey: ['usage'],
    queryFn: getUsage,
  });

  const profile = profileData?.user;
  const usage = usageData;
  const [isDeleting, setIsDeleting] = useState(false);

  // Calculate remaining analyses for display
  const remainingAnalyses = usage?.isPro 
    ? Infinity 
    : (usage?.freeAnalysesLimit || FREE_ANALYSIS_LIMIT) - (usage?.freeAnalysesUsed || 0);

  useEffect(() => {
    // Check subscription status on mount
    if (user) {
      checkSubscriptionStatus();
    }
  }, [user, checkSubscriptionStatus]);

  // Periodically check email verification status when page is visible
  useEffect(() => {
    if (!isEmailVerified && user) {
      // Check immediately on mount
      checkEmailVerification();
      
      // Check every 10 seconds while on this page
      const interval = setInterval(() => {
        checkEmailVerification();
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [isEmailVerified, user, checkEmailVerification]);

  const handleUpgrade = () => {
    router.push('/premium');
  };

  const handleManageSubscription = async () => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('https://apps.apple.com/account/subscriptions');
      } else if (Platform.OS === 'android') {
        await Linking.openURL('https://play.google.com/store/account/subscriptions');
      } else {
        // For web, redirect to premium screen where they can manage Stripe subscription
        router.push('/premium');
      }
    } catch (error) {
      console.error('Error opening subscription management:', error);
      Alert.alert(
        'Error',
        'Unable to open subscription management. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const performSignOut = async () => {
    try {
      const success = await signOut();

      if (success) {
        // Clear React Query cache after successful sign out
        queryClient.clear();

        // Use setTimeout to ensure state updates have propagated
        setTimeout(() => {
          router.replace('/(onboarding)/home');
        }, 100);
      } else {
        Alert.alert('Error', 'Failed to sign out. Please try again.');
      }
    } catch (error) {
      console.error('Sign out error:', error);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleSignOut = () => {
    // On web, Alert.alert callbacks don't work reliably
    if (Platform.OS === 'web') {
      performSignOut();
      return;
    }

    // On mobile, show confirmation alert
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: performSignOut,
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    const email = user?.email ?? profile?.email;
    if (!email) {
      if (Platform.OS === 'web') {
        window.alert('Unable to determine your email. Please sign out and try again.');
      } else {
        Alert.alert('Error', 'Unable to determine your email. Please sign out and try again.', [{ text: 'OK' }]);
      }
      return;
    }

    const runApiAndShowResult = async () => {
      setIsDeleting(true);
      try {
        const response = await fetch(`${API_URL}/api/auth/delete-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            reason: 'User requested deletion from app settings',
          }),
        });

        if (response.ok) {
          const successTitle = 'Check Your Email';
          const successMessage = `We've sent a confirmation link to ${email}. Click the link to complete your account deletion. The link expires in 24 hours.`;
          if (Platform.OS === 'web') {
            window.alert(`${successTitle}\n\n${successMessage}`);
            await performSignOut();
          } else {
            Alert.alert(successTitle, successMessage, [
              { text: 'OK', onPress: performSignOut },
            ]);
          }
        } else {
          const errorMessage = 'Failed to process deletion request. Please try again or contact support@chartsignl.com';
          if (Platform.OS === 'web') {
            window.alert(`Error\n\n${errorMessage}`);
          } else {
            Alert.alert('Error', errorMessage, [{ text: 'OK' }]);
          }
        }
      } catch (err) {
        console.error('Delete account request error:', err);
        const errorMessage = 'Failed to process deletion request. Please try again or contact support@chartsignl.com';
        if (Platform.OS === 'web') {
          window.alert(`Error\n\n${errorMessage}`);
        } else {
          Alert.alert('Error', errorMessage, [{ text: 'OK' }]);
        }
      } finally {
        setIsDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(
        'This will permanently delete your account and all data. Continue?'
      );
      if (!confirmed) return;
      const reallyConfirmed = window.confirm(
        'Are you sure? A confirmation email will be sent to complete the deletion.'
      );
      if (!reallyConfirmed) return;
      await runApiAndShowResult();
      return;
    }

    // Native: two-step Alert
    Alert.alert(
      'Delete Account',
      'This will permanently delete your ChartSignl account, including all your saved analyses, preferences, and subscription data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              `A confirmation email will be sent to ${email}. You'll need to click the link in that email to complete the deletion.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete My Account',
                  style: 'destructive',
                  onPress: runApiAndShowResult,
                },
              ]
            );
          },
        },
      ]
    );
  };

  // Helper function to show verification required alert
  const showVerificationRequiredAlert = useCallback((featureName: string) => {
    if (Platform.OS === 'web') {
      window.alert(`Please verify your email to ${featureName}.\n\nCheck your inbox for the verification link, or use the "Resend" button above.`);
    } else {
      Alert.alert(
        'Email Verification Required',
        `Please verify your email to ${featureName}.\n\nCheck your inbox for the verification link, or use the "Resend" button above.`,
        [{ text: 'OK' }]
      );
    }
  }, []);

  // Wrapper for settings actions that require verification
  const requireVerification = useCallback((action: () => void, featureName: string) => {
    if (!isEmailVerified) {
      showVerificationRequiredAlert(featureName);
      return;
    }
    action();
  }, [isEmailVerified, showVerificationRequiredAlert]);

  const handleEditProfile = () => {
    requireVerification(() => router.push('/(settings)/edit-profile'), 'edit your profile');
  };

  const handleChangePassword = () => {
    requireVerification(() => router.push('/(settings)/change-password'), 'change your password');
  };

  const handleNotifications = () => {
    requireVerification(() => router.push('/(settings)/notifications'), 'manage notifications');
  };

  const handleHelp = () => {
    // Help is always accessible
    router.push('/(settings)/help');
  };

  const handlePrivacy = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = '/privacy';
    } else {
      Linking.openURL('https://chartsignl.com/privacy');
    }
  };

  const handleTerms = () => {
    // Terms are always accessible
    router.push('/(settings)/terms');
  };

  const handleRestorePurchases = async () => {
    // Restore purchases requires verification
    if (!isEmailVerified) {
      showVerificationRequiredAlert('restore purchases');
      return;
    }

    try {
      const Purchases = (await import('react-native-purchases')).default;

      if (user?.id) {
        await Purchases.logIn(user.id);
      }

      const customerInfo = await Purchases.restorePurchases();

      if (customerInfo.entitlements.active['premium']) {
        await refreshSubscription();
        Alert.alert(
          'Success',
          'Your premium subscription has been restored!',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'No Purchases Found',
          'We couldn\'t find any active subscriptions to restore.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('Restore error:', error);
      Alert.alert(
        'Restore Failed',
        'Unable to restore purchases. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  // Helper to render setting item with optional disabled state
  const renderSettingItem = (
    icon: keyof typeof Ionicons.glyphMap,
    text: string,
    onPress: () => void,
    requiresVerification: boolean = true
  ) => {
    const isDisabled = requiresVerification && !isEmailVerified;
    
    return (
      <TouchableOpacity 
        style={[styles.settingsItem, isDisabled && styles.settingsItemDisabled]} 
        onPress={onPress}
      >
        <View style={styles.settingsItemLeft}>
          <Ionicons 
            name={icon} 
            size={24} 
            color={isDisabled ? colors.neutral[400] : colors.neutral[600]} 
          />
          <Text style={[styles.settingsItemText, isDisabled && styles.settingsItemTextDisabled]}>
            {text}
          </Text>
          {isDisabled && (
            <View style={styles.verificationBadge}>
              <Ionicons name="mail-outline" size={12} color={colors.amber[600]} />
            </View>
          )}
        </View>
        <Ionicons 
          name="chevron-forward" 
          size={20} 
          color={isDisabled ? colors.neutral[300] : colors.neutral[400]} 
        />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
        {/* Email Verification Banner */}
        {!isEmailVerified && <EmailVerificationBanner variant="banner" />}
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {profile?.displayName?.[0]?.toUpperCase() || '👤'}
            </Text>
          </View>
          <Text style={styles.name}>{profile?.displayName || 'Trader'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {!isEmailVerified && (
            <View style={styles.unverifiedBadge}>
              <Ionicons name="alert-circle" size={14} color={colors.amber[600]} />
              <Text style={styles.unverifiedText}>Email not verified</Text>
            </View>
          )}
        </View>

        {/* Premium Upgrade Card */}
        {!isPremium ? (
          <Card style={styles.upgradeCard}>
            <View style={styles.upgradeContent}>
              <View style={styles.upgradeIcon}>
                <Text style={styles.upgradeIconText}>⚡</Text>
              </View>
              <View style={styles.upgradeTextContainer}>
                <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
                <Text style={styles.upgradeSubtitle}>
                  Unlimited analyses & premium features
                </Text>
              </View>
            </View>
            <Button
              title="Upgrade"
              onPress={handleUpgrade}
              size="sm"
              style={styles.upgradeButton}
            />
          </Card>
        ) : (
          <Card style={styles.premiumCard}>
            <View style={styles.premiumBadge}>
              <Ionicons name="star" size={20} color={colors.amber[500]} />
              <Text style={styles.premiumBadgeText}>Premium</Text>
            </View>
            <Text style={styles.premiumDescription}>
              You have unlimited chart analyses
            </Text>
          </Card>
        )}

        {/* Usage Card (for free users) */}
        {!isPremium && (
          <Card style={styles.usageCard}>
            <Text style={styles.usageTitle}>Weekly Usage</Text>
            <Text style={styles.usageCount}>
              {remainingAnalyses === Infinity ? '∞' : Math.max(0, remainingAnalyses)} analyses remaining
            </Text>
            <View style={styles.usageProgressBar}>
              <View 
                style={[
                  styles.usageProgressFill, 
                  { 
                    width: `${Math.min(100, ((usage?.freeAnalysesUsed || 0) / (usage?.freeAnalysesLimit || FREE_ANALYSIS_LIMIT)) * 100)}%` 
                  }
                ]} 
              />
            </View>
            <Text style={styles.usageProgressText}>
              {usage?.freeAnalysesUsed || 0} of {usage?.freeAnalysesLimit || FREE_ANALYSIS_LIMIT} used this week
            </Text>
          </Card>
        )}

        {/* Trading Profile */}
        {profile && (profile.tradingStyle || profile.experienceLevel) && (
          <Card style={styles.profileCard}>
            <Text style={styles.cardTitle}>Trading Profile</Text>
            {profile.tradingStyle && (
              <View style={styles.profileItem}>
                <Text style={styles.profileLabel}>Trading Style</Text>
                <Text style={styles.profileValue}>
                  {TRADING_STYLE_OPTIONS.find(o => o.value === profile.tradingStyle)?.label || profile.tradingStyle}
                </Text>
              </View>
            )}
            {profile.experienceLevel && (
              <View style={styles.profileItem}>
                <Text style={styles.profileLabel}>Experience Level</Text>
                <Text style={styles.profileValue}>
                  {profile.experienceLevel.charAt(0).toUpperCase() + profile.experienceLevel.slice(1)}
                </Text>
              </View>
            )}
          </Card>
        )}

        {/* Settings Section */}
        <Card style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Settings</Text>
          
          {/* Show hint if email not verified */}
          {!isEmailVerified && (
            <View style={styles.verificationHint}>
              <Ionicons name="information-circle" size={16} color={colors.amber[600]} />
              <Text style={styles.verificationHintText}>
                Some features require email verification
              </Text>
            </View>
          )}

          {renderSettingItem('person-outline', 'Edit Profile', handleEditProfile, true)}
          {renderSettingItem('lock-closed-outline', 'Change Password', handleChangePassword, true)}
          {renderSettingItem('notifications-outline', 'Notifications', handleNotifications, true)}
          {renderSettingItem('help-circle-outline', 'Help & Support', handleHelp, false)}
          {renderSettingItem('shield-outline', 'Privacy Policy', handlePrivacy, false)}
          {renderSettingItem('document-text-outline', 'Terms of Service', handleTerms, false)}
        </Card>

        {/* Restore Purchases (mobile only) */}
        {Platform.OS !== 'web' && (
          <TouchableOpacity 
            style={styles.restoreButton} 
            onPress={handleRestorePurchases}
          >
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>
        )}

        {/* Manage Subscription (premium users only) */}
        {isPremium && (
          <TouchableOpacity 
            style={styles.manageSubscriptionButton} 
            onPress={handleManageSubscription}
          >
            <Text style={styles.manageSubscriptionText}>Manage Subscription</Text>
          </TouchableOpacity>
        )}

        {/* Delete Account */}
        <TouchableOpacity
          style={styles.deleteAccountButton}
          onPress={handleDeleteAccount}
          disabled={isDeleting}
        >
          <View style={styles.deleteAccountInner}>
            <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </View>
        </TouchableOpacity>

        {/* Sign Out Button */}
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="outline"
          size="lg"
          fullWidth
          style={styles.signOutButton}
        />

        {/* Version */}
        <Text style={styles.versionText}>ChartSignl v1.0.0</Text>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 900;

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh' as any, overflow: 'auto' }),
    backgroundColor: colors.background,
  },
  webWrapper: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { alignItems: 'center' }),
  },
  webInner: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    width: '100%',
    ...(Platform.OS === 'web' && { maxWidth: WEB_MAX_WIDTH }),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? 100 : spacing.xxl,
  },
  // Header
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    ...typography.displayMd,
    color: colors.primary[600],
  },
  name: {
    ...typography.headingLg,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  email: {
    ...typography.bodyMd,
    color: colors.neutral[500],
  },
  unverifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.amber[50],
    borderRadius: borderRadius.full,
    gap: 4,
  },
  unverifiedText: {
    ...typography.bodySm,
    color: colors.amber[700],
    fontWeight: '500',
  },
  // Upgrade Card
  upgradeCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[200],
    borderWidth: 1,
  },
  upgradeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  upgradeIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  upgradeIconText: {
    fontSize: 24,
  },
  upgradeTextContainer: {
    flex: 1,
  },
  upgradeTitle: {
    ...typography.headingMd,
    color: colors.primary[900],
    marginBottom: spacing.xxs,
  },
  upgradeSubtitle: {
    ...typography.bodySm,
    color: colors.primary[700],
  },
  upgradeButton: {
    alignSelf: 'flex-start',
  },
  // Premium Card
  premiumCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.amber[50],
    borderColor: colors.amber[200],
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.amber[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginBottom: spacing.sm,
  },
  premiumBadgeText: {
    ...typography.labelMd,
    color: colors.amber[800],
    marginLeft: spacing.xs,
  },
  premiumDescription: {
    ...typography.bodyMd,
    color: colors.amber[800],
    marginBottom: spacing.sm,
  },
  manageLink: {
    ...typography.bodySm,
    color: colors.primary[600],
    textDecorationLine: 'underline',
  },
  // Usage Card
  usageCard: {
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  usageTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.xs,
  },
  usageCount: {
    ...typography.headingMd,
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  usageProgressBar: {
    width: '100%',
    height: 8,
    backgroundColor: colors.neutral[200],
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  usageProgressFill: {
    height: '100%',
    backgroundColor: colors.primary[500],
    borderRadius: borderRadius.full,
  },
  usageProgressText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  // Profile card
  profileCard: {
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...typography.labelLg,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  profileItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  profileLabel: {
    ...typography.bodyMd,
    color: colors.neutral[500],
  },
  profileValue: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  // Settings Card
  settingsCard: {
    marginBottom: spacing.lg,
  },
  settingsTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
    marginBottom: spacing.md,
  },
  verificationHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.amber[50],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: 8,
  },
  verificationHintText: {
    ...typography.bodySm,
    color: colors.amber[700],
    flex: 1,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  settingsItemDisabled: {
    opacity: 0.7,
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsItemText: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    marginLeft: spacing.md,
  },
  settingsItemTextDisabled: {
    color: colors.neutral[400],
  },
  verificationBadge: {
    marginLeft: spacing.sm,
    padding: 2,
    backgroundColor: colors.amber[100],
    borderRadius: borderRadius.full,
  },
  restoreButton: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  restoreText: {
    ...typography.bodySm,
    color: colors.primary[600],
    textDecorationLine: 'underline',
  },
  manageSubscriptionButton: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  manageSubscriptionText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textDecorationLine: 'underline',
  },
  deleteAccountButton: {
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
  },
  deleteAccountInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteAccountText: {
    ...typography.bodySm,
    color: colors.red[500],
  },
  signOutButton: {
    marginBottom: spacing.lg,
    backgroundColor: colors.white,
  },
  versionText: {
    ...typography.bodySm,
    color: colors.neutral[400],
    textAlign: 'center',
  },
});
