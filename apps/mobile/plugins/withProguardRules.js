/**
 * withProguardRules
 *
 * Appends custom ProGuard rules to android/app/proguard-rules.pro.
 * Currently adds keep rules for react-native-reanimated and turbomodules.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const CUSTOM_RULES = `
# ============================================================
# ChartSignl custom ProGuard rules (injected by config plugin)
# ============================================================

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
`;

function withProguardRules(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro"
      );

      let contents = "";
      if (fs.existsSync(proguardPath)) {
        contents = fs.readFileSync(proguardPath, "utf-8");
      }

      // Only append if not already present
      if (!contents.includes("com.swmansion.reanimated")) {
        contents += CUSTOM_RULES;
        fs.writeFileSync(proguardPath, contents);
      }

      return config;
    },
  ]);
}

module.exports = withProguardRules;
