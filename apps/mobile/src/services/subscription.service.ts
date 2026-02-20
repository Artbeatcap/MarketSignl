import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';

// Lazy load RevenueCat only when needed (mobile platforms only)
// This prevents web from trying to load the module at all
let Purchases: any = null;
let purchasesLoadAttempted = false;

/**
 * Lazy load RevenueCat Purchases module
 * Only loads on mobile platforms, never on web
 * Uses require() inside a function so Metro bundler can handle it conditionally
 */
function getPurchases(): any {
  if (Platform.OS === 'web') {
    return null;
  }

  if (Purchases) {
    return Purchases;
  }

  if (purchasesLoadAttempted) {
    return null;
  }

  try {
    purchasesLoadAttempted = true;
    const module = require('react-native-purchases').default;

    // Verify the native bridge is actually available
    // (JS module loads fine but native module can be null in dev builds)
    if (!module || typeof module.configure !== 'function') {
      console.warn('RevenueCat native module not available (dev build?)');
      return null;
    }

    // Test if the native bridge is actually connected
    // by checking a property that requires native access
    try {
      // This will throw if native module is null
      module.setLogLevel && module.setLogLevel(module.LOG_LEVEL?.DEBUG);
    } catch (e) {
      console.warn('RevenueCat native bridge not connected (dev build?) - skipping');
      return null;
    }

    Purchases = module;
    return Purchases;
  } catch (error) {
    console.warn('RevenueCat not available:', error);
    return null;
  }
}

export interface SubscriptionStatus {
  tier: 'free' | 'pro';
  isActive: boolean;
  expiresAt?: Date;
  platform?: 'ios' | 'android' | 'web';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}

export interface SubscriptionOfferings {
  current: {
    availablePackages: Array<{
      identifier: string;
      packageType: string;
      product: {
        identifier: string;
        description: string;
        title: string;
        price: number;
        priceString: string;
        currencyCode: string;
      };
    }>;
  } | null;
}

class SubscriptionService {
  private isInitialized = false;

  /**
   * Initialize the subscription service
   * On mobile: Initializes RevenueCat (when ready)
   * On web: No initialization needed - uses Stripe via backend
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (Platform.OS === 'web') {
      // Web doesn't need RevenueCat initialization
      this.isInitialized = true;
      console.log('Subscription service initialized for web (Stripe via backend)');
      return;
    }

    // Mobile: Try to load RevenueCat (but don't fail if not available)
    const PurchasesModule = getPurchases();
    if (!PurchasesModule) {
      console.warn('RevenueCat not available on this platform - mobile subscriptions coming soon');
      this.isInitialized = true;
      return;
    }

    try {
      if (Platform.OS === 'ios') {
        const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || process.env.REVENUECAT_IOS_KEY;
        if (iosKey) {
          await PurchasesModule.configure({ apiKey: iosKey });
          console.log('RevenueCat initialized for iOS');
        } else {
          console.error('❌ REVENUECAT IOS KEY IS MISSING - subscriptions will not work!');
          console.error('Checked: EXPO_PUBLIC_REVENUECAT_IOS_KEY and REVENUECAT_IOS_KEY');
        }
      } else if (Platform.OS === 'android') {
        const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || process.env.REVENUECAT_ANDROID_KEY;
        if (androidKey) {
          await PurchasesModule.configure({ apiKey: androidKey });
          console.log('RevenueCat initialized for Android');
        } else {
          console.error('❌ REVENUECAT ANDROID KEY IS MISSING - subscriptions will not work!');
          console.error('Checked: EXPO_PUBLIC_REVENUECAT_ANDROID_KEY and REVENUECAT_ANDROID_KEY');
        }
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing RevenueCat:', error);
      this.isInitialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Get current subscription status
   * On mobile: Checks RevenueCat + Supabase
   * On web: Checks backend API (which queries Supabase)
   * @param accessToken - Optional Supabase access token (use when available so API auth works even if localStorage key differs)
   */
  async getSubscriptionStatus(userId: string, accessToken?: string | null): Promise<SubscriptionStatus> {
    if (Platform.OS === 'web') {
      // On web, call backend API (pass token so auth works when session is in memory but not yet in localStorage)
      try {
        const response = await api.getSubscriptionStatus(accessToken);
        return {
          tier: response.isActive ? 'pro' : 'free',
          isActive: response.isActive,
          expiresAt: response.expiresAt ? new Date(response.expiresAt) : undefined,
          platform: 'web',
          currentPeriodStart: response.currentPeriodStart ? new Date(response.currentPeriodStart) : undefined,
          currentPeriodEnd: response.currentPeriodEnd ? new Date(response.currentPeriodEnd) : undefined,
        };
      } catch (error) {
        console.error('Error getting subscription status from backend:', error);
        return {
          tier: 'free',
          isActive: false,
          platform: 'web',
        };
      }
    }

    // Mobile: Check RevenueCat first, then fall back to BACKEND API (not raw Supabase)
    const PurchasesModule = getPurchases();

    // If RevenueCat native module isn't available, go straight to backend API
    if (!PurchasesModule) {
      console.warn('RevenueCat not available, falling back to backend API');
      return this.getSubscriptionStatusFromBackend(accessToken, userId);
    }

    try {
      await PurchasesModule.logIn(userId);
      const customerInfo = await PurchasesModule.getCustomerInfo();
      const hasPremium = typeof customerInfo.entitlements.active['premium'] !== 'undefined';

      if (hasPremium) {
        const activeEntitlement = customerInfo.entitlements.active['premium'];
        const platform = activeEntitlement.store === 'APP_STORE' ? 'ios' : 'android';

        await this.syncSubscriptionToSupabase(userId, {
          status: 'active',
          platform,
          productId: activeEntitlement.productIdentifier,
          expiresAt: activeEntitlement.expirationDate ? new Date(activeEntitlement.expirationDate) : undefined,
          revenuecatSubscriberId: customerInfo.originalAppUserId,
        });

        return {
          tier: 'pro',
          isActive: true,
          expiresAt: activeEntitlement.expirationDate ? new Date(activeEntitlement.expirationDate) : undefined,
          platform,
        };
      } else {
        // No RC entitlement — check backend (catches Stripe-only subscribers)
        return this.getSubscriptionStatusFromBackend(accessToken, userId);
      }
    } catch (error) {
      console.error('Error getting subscription status from RevenueCat:', error);
      // RevenueCat failed — fall back to backend API (includes Stripe sync)
      return this.getSubscriptionStatusFromBackend(accessToken, userId);
    }
  }

  /**
   * Get subscription status via backend API (includes Stripe auto-sync)
   * Used as fallback on mobile when RevenueCat is unavailable or fails
   */
  private async getSubscriptionStatusFromBackend(
    accessToken?: string | null,
    userId?: string
  ): Promise<SubscriptionStatus> {
    try {
      const response = await api.getSubscriptionStatus(accessToken);
      return {
        tier: response.isActive ? 'pro' : 'free',
        isActive: response.isActive,
        expiresAt: response.expiresAt ? new Date(response.expiresAt) : undefined,
        platform: response.platform as 'ios' | 'android' | 'web' | undefined,
        currentPeriodStart: response.currentPeriodStart ? new Date(response.currentPeriodStart) : undefined,
        currentPeriodEnd: response.currentPeriodEnd ? new Date(response.currentPeriodEnd) : undefined,
      };
    } catch (error) {
      console.error('Error getting subscription status from backend:', error);
      // Last resort: try Supabase directly
      return this.getSubscriptionStatusFromSupabase(userId ?? '');
    }
  }

  /**
   * Get subscription status from Supabase directly
   */
  private async getSubscriptionStatusFromSupabase(userId: string): Promise<SubscriptionStatus> {
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return {
          tier: 'free',
          isActive: false,
        };
      }

      const isActive = data.status === 'active' && 
        (!data.current_period_end || new Date(data.current_period_end) > new Date());

      return {
        tier: isActive ? 'pro' : 'free',
        isActive,
        expiresAt: data.current_period_end ? new Date(data.current_period_end) : data.expires_at ? new Date(data.expires_at) : undefined,
        platform: data.platform as 'ios' | 'android' | 'web' | undefined,
        currentPeriodStart: data.current_period_start ? new Date(data.current_period_start) : undefined,
        currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : undefined,
      };
    } catch (error) {
      console.error('Error getting subscription from Supabase:', error);
      return {
        tier: 'free',
        isActive: false,
      };
    }
  }

  /**
   * Sync subscription data to Supabase
   */
  private async syncSubscriptionToSupabase(
    userId: string,
    data: {
      status: 'active' | 'cancelled' | 'expired' | 'free';
      platform: 'ios' | 'android' | 'web';
      productId?: string;
      expiresAt?: Date;
      revenuecatSubscriberId?: string;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
    }
  ): Promise<void> {
    try {
      const updateData: any = {
        user_id: userId,
        status: data.status,
        platform: data.platform,
        updated_at: new Date().toISOString(),
      };

      if (data.productId) updateData.product_id = data.productId;
      if (data.expiresAt) updateData.expires_at = data.expiresAt.toISOString();
      if (data.revenuecatSubscriberId) updateData.revenuecat_subscriber_id = data.revenuecatSubscriberId;
      if (data.currentPeriodStart) updateData.current_period_start = data.currentPeriodStart.toISOString();
      if (data.currentPeriodEnd) updateData.current_period_end = data.currentPeriodEnd.toISOString();

      await supabase
        .from('subscriptions')
        .upsert(updateData, { onConflict: 'user_id' });

      // Also update profiles.is_pro
      await supabase
        .from('profiles')
        .update({ is_pro: data.status === 'active' })
        .eq('id', userId);
    } catch (error) {
      console.error('Error syncing subscription to Supabase:', error);
    }
  }

  /**
   * Get available subscription offerings
   * On mobile: Returns RevenueCat offerings
   * On web: Returns null (use Stripe checkout instead)
   */
  async getOfferings(): Promise<SubscriptionOfferings | null> {
    if (Platform.OS === 'web') {
      return null; // Web uses Stripe checkout, not offerings
    }

    const PurchasesModule = getPurchases();
    if (!PurchasesModule) {
      return null;
    }

    try {
      const offerings = await PurchasesModule.getOfferings();
      return offerings;
    } catch (error) {
      console.error('Error getting offerings:', error);
      return null;
    }
  }

  /**
   * Purchase a subscription
   * On mobile: Uses RevenueCat purchasePackage
   * On web: Creates Stripe checkout session and returns URL
   * @param accessToken - Optional Supabase access token (use when available to avoid localStorage auth issues)
   */
  async purchaseSubscription(
    packageToPurchase?: any,
    userId?: string,
    accessToken?: string | null
  ): Promise<{ success: boolean; checkoutUrl?: string }> {
    if (Platform.OS === 'web') {
      // Create Stripe checkout session (pass token so redirect works even if localStorage key differs)
      try {
        const response = await api.createCheckoutSession(accessToken);
        const url = response?.checkoutUrl;
        return {
          success: !!url,
          checkoutUrl: url ?? undefined,
        };
      } catch (error) {
        console.error('Error creating Stripe checkout:', error);
        throw error;
      }
    }

    // Mobile: Use RevenueCat
    const PurchasesModule = getPurchases();
    if (!PurchasesModule || !packageToPurchase) {
      throw new Error('Mobile subscriptions coming soon. Please use web app to subscribe.');
    }

    try {
      // Ensure user is identified with RevenueCat if userId provided
      if (userId) {
        await PurchasesModule.logIn(userId);
      }

      const purchaseResult = await PurchasesModule.purchasePackage(packageToPurchase);
      const hasPremium = typeof purchaseResult.customerInfo.entitlements.active['premium'] !== 'undefined';
      
      if (hasPremium) {
        const activeEntitlement = purchaseResult.customerInfo.entitlements.active['premium'];
        const platform = activeEntitlement.store === 'APP_STORE' ? 'ios' : 'android';
        const subscriberId = purchaseResult.originalAppUserId || userId || '';
        
        // Sync to Supabase
        if (subscriberId) {
          await this.syncSubscriptionToSupabase(subscriberId, {
            status: 'active',
            platform,
            productId: activeEntitlement.productIdentifier,
            expiresAt: activeEntitlement.expirationDate ? new Date(activeEntitlement.expirationDate) : undefined,
            revenuecatSubscriberId: subscriberId,
          });
        }

        return { success: true };
      } else {
        throw new Error('Purchase completed but premium was not activated');
      }
    } catch (error: any) {
      if (error.userCancelled) {
        throw new Error('Purchase cancelled');
      }
      throw error;
    }
  }

  /**
   * Restore purchases (mobile only)
   */
  async restorePurchases(userId: string): Promise<boolean> {
    if (Platform.OS === 'web') {
      // Web doesn't have restore purchases
      return false;
    }

    const PurchasesModule = getPurchases();
    if (!PurchasesModule) {
      return false;
    }

    try {
      await PurchasesModule.logIn(userId);
      const customerInfo = await PurchasesModule.restorePurchases();
      const hasPremium = typeof customerInfo.entitlements.active['premium'] !== 'undefined';
      
      if (hasPremium) {
        const activeEntitlement = customerInfo.entitlements.active['premium'];
        const platform = activeEntitlement.store === 'APP_STORE' ? 'ios' : 'android';
        
        await this.syncSubscriptionToSupabase(userId, {
          status: 'active',
          platform,
          productId: activeEntitlement.productIdentifier,
          expiresAt: activeEntitlement.expirationDate ? new Date(activeEntitlement.expirationDate) : undefined,
          revenuecatSubscriberId: customerInfo.originalAppUserId,
        });
      }

      return hasPremium;
    } catch (error) {
      console.error('Error restoring purchases:', error);
      return false;
    }
  }

  /**
   * Log out from RevenueCat (mobile only)
   */
  async logOut(): Promise<void> {
    if (Platform.OS === 'web') {
      return;
    }

    const PurchasesModule = getPurchases();
    if (!PurchasesModule) {
      return;
    }

    try {
      await PurchasesModule.logOut();
    } catch (error) {
      console.error('Error logging out from RevenueCat:', error);
    }
  }
}

export const subscriptionService = new SubscriptionService();
