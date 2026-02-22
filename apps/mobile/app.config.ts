import { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "ChartSignl",
  slug: "chartsignl",
  version: "1.0.24",
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
    associatedDomains: [
      "applinks:chartsignl.com",
      "applinks:www.chartsignl.com",
    ],
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
    versionCode: 28,

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
  },

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
    "./plugins/withMonorepoConfig",

    // Android SDK versions for Expo modules (compileSdk/targetSdk/buildTools)
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: "35.0.0",
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

    // Gradle properties: keystore passwords (from secrets/.env.signing) + arch filter
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
    revenueCatIosKey:
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ||
      process.env.REVENUECAT_IOS_KEY,
    revenueCatAndroidKey:
      process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ||
      process.env.REVENUECAT_ANDROID_KEY,
  },
});
