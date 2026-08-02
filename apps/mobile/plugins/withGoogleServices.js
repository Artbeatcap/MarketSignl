/**
 * withGoogleServices
 *
 * Android FCM requires:
 * 1. google-services.json in android/app/
 * 2. Google Services Gradle plugin on the app module
 *
 * Source file: apps/mobile/google-services.json (gitignored; uploaded to EAS via .easignore)
 */
const {
  withAppBuildGradle,
  withProjectBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const GOOGLE_SERVICES_CLASSPATH =
  "classpath('com.google.gms:google-services:4.4.2')";
const GOOGLE_SERVICES_PLUGIN = 'apply plugin: "com.google.gms.google-services"';

function withGoogleServicesCopy(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;
      const src = path.join(projectRoot, "google-services.json");
      const dest = path.join(platformRoot, "app", "google-services.json");

      if (!fs.existsSync(src)) {
        console.warn(
          `  ⚠️  google-services.json not found at ${src}\n` +
            "     Android push will fail until you download it from Firebase Console."
        );
        return config;
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log("  ✅ google-services.json copied → android/app/");
      return config;
    },
  ]);
}

function withGoogleServicesClasspath(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("com.google.gms:google-services")) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    ${GOOGLE_SERVICES_CLASSPATH}`
      );
    }
    config.modResults.contents = contents;
    return config;
  });
}

function withGoogleServicesPlugin(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("com.google.gms.google-services")) {
      contents = `${contents.trim()}\n\n${GOOGLE_SERVICES_PLUGIN}\n`;
    }
    config.modResults.contents = contents;
    return config;
  });
}

function withGoogleServices(config) {
  config = withGoogleServicesCopy(config);
  config = withGoogleServicesClasspath(config);
  config = withGoogleServicesPlugin(config);
  return config;
}

module.exports = withGoogleServices;
