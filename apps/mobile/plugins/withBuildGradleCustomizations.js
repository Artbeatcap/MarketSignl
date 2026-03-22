/**
 * withBuildGradleCustomizations
 *
 * Adds to android/app/build.gradle:
 * - Play Billing Library 6+ dependency (required by Google Play; RevenueCat uses it transitively)
 * - resConfigs "en" to filter out unnecessary locale resources
 */
const { withAppBuildGradle } = require("expo/config-plugins");

function withBuildGradleCustomizations(config) {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    // --- Add resConfigs "en" inside defaultConfig ---
    if (!buildGradle.includes('resConfigs')) {
      buildGradle = buildGradle.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {
        resConfigs "en"  // Only include English, filters out cb, fb`
      );
    }

    // --- Add Play Billing Library dependency ---
    if (!buildGradle.includes("com.android.billingclient:billing")) {
      buildGradle = buildGradle.replace(
        /dependencies\s*\{/,
        `dependencies {
    // Force Play Billing Library 6+ (required by Google Play; RevenueCat uses it transitively)
    implementation("com.android.billingclient:billing:6.1.0")`
      );
    }

    // --- Fix Kotlin version for SDK 52 (RN 0.76) ---
    buildGradle = buildGradle.replace(
      /kotlinVersion\s*=\s*["'][\d.]+["']/,
      'kotlinVersion = "2.0.21"'
    );

    config.modResults.contents = buildGradle;
    return config;
  });
}

module.exports = withBuildGradleCustomizations;
