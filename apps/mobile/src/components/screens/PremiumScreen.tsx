import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useRouter, useLocalSearchParams, useRootNavigationState } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { Card, Button } from '../index';
import { useAuthStore } from '../../store/authStore';
import { subscriptionService } from '../../services/subscription.service';
import * as api from '../../lib/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

interface PremiumFeature {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

interface ComparisonItem {
  feature: string;
  free: string | boolean;
  premium: string | boolean;
}

const PREMIUM_FEATURES: PremiumFeature[] = [
  {
    icon: 'infinite',
    title: 'Unlimited Atlas Analyses',
    description: 'Get unlimited AI-powered level detection',
  },
  {
    icon: 'layers',
    title: 'All Timeframes',
    description: 'Access 1-hour, 4-hour, daily, and weekly chart analysis',
  },
  {
    icon: 'analytics',
    title: 'Support & Resistance Levels',
    description: 'Atlas-identified key price levels with confluence scoring',
  },
  {
    icon: 'trending-up',
    title: 'Technical Indicators',
    description: 'EMA overlays and technical analysis on all charts',
  },
  {
    icon: 'time',
    title: 'Analysis History',
    description: 'Full access to your saved analysis history',
  },
  {
    icon: 'star',
    title: 'Priority Support',
    description: 'Get priority customer support and feature requests',
  },
];

const COMPARISON_DATA: ComparisonItem[] = [
  {
    feature: 'Weekly Analyses',
    free: '3 per week',
    premium: 'Unlimited',
  },
  {
    feature: 'Timeframes',
    free: 'All timeframes',
    premium: 'All timeframes',
  },
  {
    feature: 'Support & Resistance',
    free: true,
    premium: true,
  },
  {
    feature: 'Technical Indicators',
    free: true,
    premium: true,
  },
  {
    feature: 'Analysis History',
    free: 'Last 3 analyses',
    premium: 'Full history',
  },
  {
    feature: 'Priority Support',
    free: false,
    premium: true,
  },
];

export default function PremiumScreen() {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const params = useLocalSearchParams<{ success?: string; canceled?: string }>();
  const { refreshSubscription, user, isPremium, session, isInitialized, isLoading: authLoading } = useAuthStore();
  const [offerings, setOfferings] = useState<PurchasesOffering | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<PurchasesPackage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [confirmingAfterCheckout, setConfirmingAfterCheckout] = useState(false);
  const successHandledRef = useRef(false);

  useEffect(() => {
    // Temporary diagnostic: RevenueCat Android key when Premium mounts (check Logcat)
    console.log('RC Android Key:', process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ? 'SET' : 'MISSING');
    loadOfferings();
  }, []);

  // Handle Stripe redirect query params — wait for user so refreshSubscription can run
  useEffect(() => {
    if (!navigationState?.key) return;

    if (params.success === 'true') {
      const currentUser = user ?? session?.user;
      if (!currentUser) return;
      if (successHandledRef.current) return;
      successHandledRef.current = true;

      setConfirmingAfterCheckout(true);

      const confirmSubscription = (retries = 0): Promise<void> => {
        const maxRetries = 3;
        const retryDelayMs = 1500;
        return refreshSubscription().then((isActive) => {
          if (isActive) {
            setConfirmingAfterCheckout(false);
            router.replace('/(tabs)/analyze');
            Alert.alert(
              'Welcome to Premium! 🎉',
              'Your subscription is now active. Enjoy unlimited access to all premium features!',
              [{ text: 'Get Started' }]
            );
            return;
          }
          if (retries < maxRetries) {
            return new Promise((resolve) => setTimeout(resolve, retryDelayMs)).then(() =>
              confirmSubscription(retries + 1)
            );
          }
          setConfirmingAfterCheckout(false);
          router.replace('/(tabs)/analyze');
          Alert.alert(
            'Payment Received',
            'Your subscription may take a moment to activate. If the screen does not update, refresh the page.',
            [{ text: 'OK' }]
          );
        });
      };

      confirmSubscription().catch((err) => {
        console.error('Error confirming subscription:', err);
        setConfirmingAfterCheckout(false);
        router.replace('/(tabs)/analyze');
        Alert.alert(
          'Subscription Updated',
          'There was a delay confirming your subscription. If you don\'t see Premium access, refresh the page.',
          [{ text: 'OK' }]
        );
      });
      return;
    }

    if (params.canceled === 'true') {
      Alert.alert(
        'Checkout Canceled',
        'Your subscription was not completed. You can try again anytime.',
        [{ text: 'OK' }]
      );
      router.replace('/premium');
    }
  }, [params.success, params.canceled, navigationState?.key, user?.id, session?.user?.id]);

  const loadOfferings = async () => {
    try {
      setIsLoading(true);
      
      // Skip RevenueCat entirely on web
      if (Platform.OS === 'web') {
        console.log('Web platform detected. Using Stripe checkout.');
        setIsLoading(false);
        return; // No RevenueCat on web
      }
      
      // Use subscription service so RevenueCat is configured before getOfferings
      await subscriptionService.initialize();
      const offeringsData = await subscriptionService.getOfferings();
      
      if (offeringsData?.current != null) {
        setOfferings(offeringsData.current);
        const monthlyPackage = offeringsData.current.availablePackages.find(
          (pkg) => pkg.identifier === '$rc_monthly' || pkg.packageType === 'MONTHLY'
        ) || offeringsData.current.availablePackages[0];
        
        if (monthlyPackage) {
          setSelectedPackage(monthlyPackage);
        }
      } else if (!isPremium) {
        Alert.alert(
          'No Plans Available',
          'Subscription plans are not available at the moment. Please try again later.',
          [
            { text: 'Retry', onPress: loadOfferings },
            { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
          ]
        );
      }
    } catch (error) {
      console.error('Error loading offerings:', error);
      if (!isPremium && Platform.OS !== 'web') {
        Alert.alert(
          'Error',
          'Failed to load subscription plans. Please check your connection and try again.',
          [
            { text: 'Retry', onPress: loadOfferings },
            { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
          ]
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async () => {
    // Check if we have a session but user is not yet loaded - try to get user from session
    let currentUser = user;
    if (!currentUser && session?.user) {
      currentUser = session.user;
    }
    
    if (!currentUser) {
      Alert.alert(
        'Login Required',
        'You must be logged in to purchase a subscription. Please sign in or create an account first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Sign In', 
            onPress: () => router.replace('/(onboarding)/account')
          }
        ]
      );
      return;
    }

    // Web: Use Stripe checkout
    if (Platform.OS === 'web') {
      try {
        setIsPurchasing(true);
        const token = session?.access_token ?? null;
        const result = await subscriptionService.purchaseSubscription(undefined, currentUser.id, token);
        const checkoutUrl = result?.checkoutUrl;
        if (checkoutUrl && typeof checkoutUrl === 'string') {
          // Redirect to Stripe checkout
          if (typeof window !== 'undefined') {
            window.location.assign(checkoutUrl);
          } else {
            await Linking.openURL(checkoutUrl);
          }
        } else {
          Alert.alert(
            'Checkout Error',
            'Failed to create checkout session. Please try again or contact support if the problem persists.',
            [{ text: 'OK' }]
          );
        }
      } catch (error: any) {
        console.error('Purchase error:', error);
        const errorMessage = error?.message || error?.error || 'An error occurred during purchase.';
        
        // Provide more specific error messages
        let userMessage = 'An error occurred during purchase. Please try again.';
        if (errorMessage.includes('authorization') || errorMessage.includes('token')) {
          userMessage = 'Your session has expired. Please sign in again and try again.';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          userMessage = 'Network error. Please check your connection and try again.';
        } else if (errorMessage) {
          userMessage = errorMessage;
        }
        
        Alert.alert('Purchase Failed', userMessage, [{ text: 'OK' }]);
      } finally {
        setIsPurchasing(false);
      }
      return;
    }

    // Mobile: Use RevenueCat
    if (!selectedPackage) {
      Alert.alert('Error', 'Please select a subscription plan.');
      return;
    }

    try {
      setIsPurchasing(true);
      const result = await subscriptionService.purchaseSubscription(
        selectedPackage,
        user.id,
        session?.access_token ?? undefined
      );
      if (result.success) {
        await refreshSubscription();
        Alert.alert(
          'Welcome to Premium! 🎉',
          'Your subscription is now active. Enjoy unlimited access to all premium features!',
          [{ text: 'Get Started', onPress: () => router.back() }]
        );
      } else {
        Alert.alert('Error', 'Purchase completed but premium was not activated. Please contact support.');
      }
    } catch (error: any) {
      console.error('Purchase error:', error);
      if (error?.userCancelled || error?.message === 'Purchase cancelled') return;
      Alert.alert(
        'Purchase Failed',
        error.message || 'An error occurred during purchase. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to restore purchases.');
      return;
    }

    // Web: Restore not applicable (subscriptions managed via Stripe)
    if (Platform.OS === 'web') {
      Alert.alert(
        'Restore Purchases',
        'Web subscriptions are managed through Stripe. Please use "Manage Subscription" to view your subscription status.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Mobile: Use subscription service (same configured RevenueCat instance)
    try {
      setIsRestoring(true);
      const hasPremium = await subscriptionService.restorePurchases(user.id);
      if (hasPremium) {
        await refreshSubscription();
        Alert.alert(
          'Purchases Restored',
          'Your premium subscription has been restored successfully!',
          [{ text: 'OK', onPress: () => router.back() }]
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
        error.message || 'Failed to restore purchases. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsRestoring(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      if (Platform.OS === 'ios') {
        // Open iOS subscription management
        await Linking.openURL('https://apps.apple.com/account/subscriptions');
      } else if (Platform.OS === 'android') {
        // Open Google Play subscription management
        await Linking.openURL('https://play.google.com/store/account/subscriptions');
      } else if (Platform.OS === 'web') {
        // Web: Open Stripe Customer Portal
        setIsCancelling(true);
        try {
          const token = session?.access_token;
          const response = await api.createCustomerPortalSession(token);
          
          if (response.success && response.url) {
            // Redirect to Stripe Customer Portal
            window.location.href = response.url;
          } else {
            window.alert(`Unable to open subscription management. ${response.error || 'Please try again'}\n\nContact support@chartsignl.com if this continues.`);
          }
        } catch (portalError) {
          console.error('Error creating portal session:', portalError);
          window.alert(`Unable to open subscription management. ${(portalError as Error).message || 'Unknown error'}\n\nContact support@chartsignl.com if this continues.`);
        } finally {
          setIsCancelling(false);
        }
      } else {
        // Fallback
        Alert.alert(
          'Manage Subscription',
          'Please manage your subscription through the App Store or Google Play Store where you originally subscribed.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error opening subscription management:', error);
      if (Platform.OS === 'web') {
        window.alert('Unable to open subscription management. Please try again.');
      } else {
        Alert.alert(
          'Error',
          'Unable to open subscription management. Please go to your device\'s Settings > Subscriptions to manage your subscription.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleCancelSubscription = () => {
    if (Platform.OS === 'web') {
      // Web: Redirect to Stripe Customer Portal for self-service cancellation
      handleManageSubscription();
    } else {
      Alert.alert(
        'Cancel Subscription',
        'To cancel your subscription, you\'ll need to manage it through the App Store or Google Play Store. Would you like to open subscription settings?',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Settings', onPress: handleManageSubscription },
        ]
      );
    }
  };

  const handleTermsPress = () => {
    router.push('/(settings)/terms');
  };

  const handlePrivacyPress = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = '/privacy';
    } else {
      Linking.openURL('https://chartsignl.com/privacy');
    }
  };

  const renderComparisonRow = (item: ComparisonItem, index: number) => {
    const renderValue = (value: string | boolean, isPremiumColumn: boolean) => {
      if (typeof value === 'boolean') {
        return value ? (
          <Ionicons name="checkmark-circle" size={20} color={isPremiumColumn ? colors.primary[500] : colors.neutral[400]} />
        ) : (
          <Ionicons name="close-circle" size={20} color={colors.neutral[300]} />
        );
      }
      return (
        <Text style={[styles.comparisonValue, isPremiumColumn && styles.comparisonValuePremium]}>
          {value}
        </Text>
      );
    };

    return (
      <View key={index} style={[styles.comparisonRow, index % 2 === 0 && styles.comparisonRowAlt]}>
        <Text style={styles.comparisonFeature}>{item.feature}</Text>
        <View style={styles.comparisonCell}>{renderValue(item.free, false)}</View>
        <View style={styles.comparisonCell}>{renderValue(item.premium, true)}</View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.webWrapper}>
          <View style={styles.webInner}>
            <View style={styles.topHeader}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.backButton}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // After Stripe redirect: show confirming until we've refreshed and got isPremium
  if (confirmingAfterCheckout) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.webWrapper}>
          <View style={styles.webInner}>
            <View style={styles.topHeader}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.backButton}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text style={styles.loadingText}>Confirming your subscription...</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Premium user view - show subscription management
  if (isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.webWrapper}>
          <View style={styles.webInner}>
            <View style={styles.topHeader}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.backButton}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainerPremium}>
              <Ionicons name="star" size={48} color={colors.primary[500]} />
            </View>
            <Text style={styles.title}>Premium Active</Text>
            <Text style={styles.subtitle}>
              You have access to all premium features
            </Text>
          </View>

          {/* Current Plan Card */}
          <Card style={styles.currentPlanCard}>
            <View style={styles.currentPlanHeader}>
              <View style={styles.premiumBadge}>
                <Ionicons name="star" size={16} color={colors.primary[500]} />
                <Text style={styles.premiumBadgeText}>Premium</Text>
              </View>
              <Text style={styles.currentPlanPrice}>$4.99/month</Text>
            </View>
            <Text style={styles.currentPlanDescription}>
              Your subscription renews automatically each month. You can manage or cancel your subscription at any time.
            </Text>
          </Card>

          {/* Features List */}
          <Card style={styles.featuresCard}>
            <Text style={styles.sectionTitle}>Your Premium Features</Text>
            {PREMIUM_FEATURES.map((feature, index) => (
              <View key={index} style={styles.featureItem}>
                <View style={styles.featureIcon}>
                  <Ionicons name={feature.icon} size={24} color={colors.primary[500]} />
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDescription}>{feature.description}</Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Manage Subscription */}
          <Button
            title="Manage Subscription"
            onPress={handleManageSubscription}
            variant="outline"
            fullWidth
            style={styles.manageButton}
          />

          <Button
            title="Cancel Subscription"
            onPress={handleCancelSubscription}
            variant="ghost"
            fullWidth
            style={styles.cancelButton}
          />

          {/* Info Text */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              {Platform.OS === 'web' 
                ? 'Subscriptions are managed through Stripe. Cancellation takes effect at the end of your current billing period.'
                : 'Subscriptions are managed through the App Store or Google Play Store. Cancellation takes effect at the end of your current billing period.'}
            </Text>
          </View>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Non-premium user view - show upgrade options
  return (
      <SafeAreaView style={styles.container}>
        <View style={styles.webWrapper}>
          <View style={styles.webInner}>
          <View style={styles.topHeader}>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="star" size={48} color={colors.primary[500]} />
          </View>
          <Text style={styles.title}>Upgrade to Premium</Text>
          <Text style={styles.subtitle}>
            Unlock unlimited analysis for just $4.99/month
          </Text>
        </View>

        {/* Plan Comparison */}
        <Card style={styles.comparisonCard}>
          <Text style={styles.sectionTitle}>Compare Plans</Text>
          <View style={styles.comparisonHeader}>
            <Text style={styles.comparisonHeaderLabel}>Feature</Text>
            <Text style={styles.comparisonHeaderPlan}>Free</Text>
            <Text style={[styles.comparisonHeaderPlan, styles.comparisonHeaderPremium]}>Premium</Text>
          </View>
          {COMPARISON_DATA.map((item, index) => renderComparisonRow(item, index))}
        </Card>

        {/* Features List */}
        <Card style={styles.featuresCard}>
          <Text style={styles.sectionTitle}>Premium Features</Text>
          {PREMIUM_FEATURES.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name={feature.icon} size={24} color={colors.primary[500]} />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Subscription Plan */}
        {offerings && selectedPackage && (
          <Card style={styles.planCard}>
            <Text style={styles.sectionTitle}>Subscription Plan</Text>
            <View style={styles.planContainer}>
              <View style={styles.planInfo}>
                <Text style={styles.planName}>Monthly Premium</Text>
                <Text style={styles.planPrice}>
                  {selectedPackage.product.priceString || '$4.99'}/month
                </Text>
                <Text style={styles.planDescription}>
                  Cancel anytime. Billed monthly.
                </Text>
              </View>
              <View style={styles.selectedIndicator}>
                <Ionicons name="checkmark-circle" size={24} color={colors.primary[500]} />
              </View>
            </View>
          </Card>
        )}

        {/* Fallback if no offerings loaded */}
        {!offerings && (
          <Card style={styles.planCard}>
            <Text style={styles.sectionTitle}>Subscription Plan</Text>
            <View style={styles.planContainer}>
              <View style={styles.planInfo}>
                <Text style={styles.planName}>Monthly Premium</Text>
                <Text style={styles.planPrice}>$4.99/month</Text>
                <Text style={styles.planDescription}>
                  Cancel anytime. Billed monthly.
                </Text>
              </View>
              <View style={styles.selectedIndicator}>
                <Ionicons name="checkmark-circle" size={24} color={colors.primary[500]} />
              </View>
            </View>
          </Card>
        )}

        {/* Purchase Button */}
        <Button
          title={isPurchasing ? 'Processing...' : 'Start Premium - $4.99/month'}
          onPress={handlePurchase}
          disabled={isPurchasing || (Platform.OS !== 'web' && !selectedPackage && !!offerings)}
          loading={isPurchasing}
          fullWidth
          style={styles.purchaseButton}
        />

        {/* Restore Button */}
        <Button
          title={isRestoring ? 'Restoring...' : 'Restore Purchases'}
          onPress={handleRestore}
          disabled={isRestoring}
          loading={isRestoring}
          variant="ghost"
          fullWidth
          style={styles.restoreButton}
        />

        {/* Terms */}
        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink} onPress={handleTermsPress}>
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text style={styles.termsLink} onPress={handlePrivacyPress}>
              Privacy Policy
            </Text>
            .             Subscription will auto-renew unless cancelled at least 24 hours before the end of the current period.
          </Text>
        </View>
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
    ...(Platform.OS === 'web' && { height: '100vh', overflow: 'auto' }),
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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    minWidth: 60,
  },
  backText: {
    ...typography.bodyMd,
    color: colors.primary[600],
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    marginTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconContainerPremium: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.primary[300],
  },
  title: {
    ...typography.displayMd,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyLg,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  // Comparison styles
  comparisonCard: {
    marginBottom: spacing.lg,
  },
  comparisonHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  comparisonHeaderLabel: {
    flex: 2,
    ...typography.labelMd,
    color: colors.neutral[600],
  },
  comparisonHeaderPlan: {
    flex: 1,
    ...typography.labelMd,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  comparisonHeaderPremium: {
    color: colors.primary[600],
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  comparisonRowAlt: {
    backgroundColor: colors.neutral[50],
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  comparisonFeature: {
    flex: 2,
    ...typography.bodySm,
    color: colors.neutral[700],
  },
  comparisonCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comparisonValue: {
    ...typography.bodySm,
    color: colors.neutral[600],
    textAlign: 'center',
  },
  comparisonValuePremium: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  // Features styles
  featuresCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
    marginBottom: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  featureDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
    lineHeight: 20,
  },
  // Current plan styles (for premium users)
  currentPlanCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.primary[50],
  },
  currentPlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  premiumBadgeText: {
    ...typography.labelSm,
    color: colors.primary[700],
    marginLeft: spacing.xs,
  },
  currentPlanPrice: {
    ...typography.headingMd,
    color: colors.primary[600],
  },
  currentPlanDescription: {
    ...typography.bodySm,
    color: colors.neutral[600],
    lineHeight: 20,
  },
  // Plan styles
  planCard: {
    marginBottom: spacing.lg,
  },
  planContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.lg,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  planPrice: {
    ...typography.displaySm,
    color: colors.primary[600],
    marginBottom: spacing.xs,
  },
  planDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  selectedIndicator: {
    marginLeft: spacing.md,
  },
  purchaseButton: {
    marginBottom: spacing.md,
  },
  restoreButton: {
    marginBottom: spacing.lg,
  },
  manageButton: {
    marginBottom: spacing.md,
  },
  cancelButton: {
    marginBottom: spacing.lg,
  },
  infoContainer: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    ...typography.bodySm,
    color: colors.neutral[400],
    textAlign: 'center',
    lineHeight: 20,
  },
  termsContainer: {
    paddingHorizontal: spacing.md,
  },
  termsText: {
    ...typography.bodySm,
    color: colors.neutral[400],
    textAlign: 'center',
    lineHeight: 20,
  },
  termsLink: {
    ...typography.bodySm,
    color: colors.primary[600],
    textDecorationLine: 'underline',
  },
});
