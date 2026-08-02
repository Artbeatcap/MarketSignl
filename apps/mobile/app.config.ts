import { ConfigContext, ExpoConfig } from "expo/config";
import { existsSync } from "fs";
import { resolve } from "path";

const googleServicesFile = "./google-services.json";
const hasGoogleServices = existsSync(
  resolve(__dirname, "google-services.json")
);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "ChartSignl",
  slug: "chartsignl",
  version: "1.1.3",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "chartsignl",
  userInterfaceStyle: "light",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#F0F9F9",
  },
  assetBundlePatterns: ["**/*"],

  // =========================================================================
  // iOS
  // =========================================================================
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.optionsplungellc.chartsignl",
    buildNumber: "25",
    associatedDomains: [
      "applinks:chartsignl.com",
      "applinks:www.chartsignl.com",
    ],
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1"],
        },
      ],
    },
    entitlements: {
      "com.apple.developer.applesignin": ["Default"],
    },
  },

  // =========================================================================
  // Android
  // =========================================================================
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#F0F9F9",
    },
    package: "com.optionsplungellc.chartsignl",
    permissions: ["com.android.vending.BILLING"],
    versionCode: 34,

    // Required for the modern Expo Notifications API on Android
    useNextNotificationsApi: true,

    // FCM: download from Firebase Console (package com.optionsplungellc.chartsignl)
    ...(hasGoogleServices ? { googleServicesFile } : {}),

    // App Links: replaces manual intent-filter in AndroidManifest.xml
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "chartsignl.com" },
          { scheme: "https", host: "www.chartsignl.com" },
        ],
        category: ["DEFAULT", "BROWSABLE"],
      },
    ],
  } as any,

  // =========================================================================
  // Web
  // =========================================================================
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },

  // =========================================================================
  // Plugins — ensure native customizations survive `npx expo prebuild --clean`
  // =========================================================================
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-web-browser",
    ["expo-notifications", { color: "#14B8A6", mode: "production" }],
    "./plugins/withGoogleServices",
    "./plugins/withMonorepoConfig",

    // Android SDK versions for Expo modules (compileSdk/targetSdk/buildTools)
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: "36.0.0",
          ndkVersion: "27.1.12297006",
        },
      },
    ],

    // Release keystore: copies from secrets/ → android/app/, injects signing config
    "./plugins/withReleaseSigning",

    // Play Billing Library dependency + resConfigs "en"
    "./plugins/withBuildGradleCustomizations",

    // ProGuard keep rules for reanimated + turbomodules
    "./plugins/withProguardRules",

    // Brand colors in colors.xml
    "./plugins/withCustomTheme",

    // Gradle properties: SDK versions + arch filter (no signing secrets)
    "./plugins/withGradleConfig",

    ["react-native-edge-to-edge", { android: { parentTheme: "Light", enforceNavigationBarContrast: false } }],
  ],

  // =========================================================================
  // Experiments
  // =========================================================================
  experiments: {
    typedRoutes: true,
  },

  // =========================================================================
  // Extra runtime config
  // =========================================================================
  extra: {
    eas: {
      projectId: "6d633a95-d09f-43c6-959f-20879ad24a44",
    },
    revenueCatIosKey:
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ||
      process.env.REVENUECAT_IOS_KEY,
    revenueCatAndroidKey:
      process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ||
      process.env.REVENUECAT_ANDROID_KEY,
  },
});
