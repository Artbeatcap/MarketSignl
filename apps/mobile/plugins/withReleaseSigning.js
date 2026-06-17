/**
 * withReleaseSigning
 *
 * Two jobs:
 * 1. Copies the keystore file from apps/mobile/secrets/ into android/app/
 *    (so it survives prebuild --clean)
 * 2. Injects the signingConfigs block into android/app/build.gradle
 *
 * The keystore file itself lives at: apps/mobile/secrets/chartsignl-release.keystore
 * This path is OUTSIDE android/ and is never deleted by prebuild.
 * Passwords are resolved at Gradle build time from environment variables or
 * apps/mobile/secrets/.env.signing. They are never written to gradle.properties.
 */
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withKeystoreCopy(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot; // apps/mobile
      const platformRoot = config.modRequest.platformProjectRoot; // apps/mobile/android

      const srcKeystore = path.join(projectRoot, "secrets", "chartsignl-release.keystore");
      const destKeystore = path.join(platformRoot, "app", "chartsignl-release.keystore");

      if (fs.existsSync(srcKeystore)) {
        // Ensure destination directory exists
        const destDir = path.dirname(destKeystore);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcKeystore, destKeystore);
        console.log("  ✅ Keystore copied from secrets/ → android/app/");
      } else {
        console.warn(
          `  ⚠️  Keystore not found at ${srcKeystore}\n` +
          `     Release builds will fail. Run: node scripts/setup-signing.js`
        );
      }

      return config;
    },
  ]);
}

function withSigningConfig(config) {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    // Don't inject twice
    if (buildGradle.includes("resolveReleaseSigning")) {
      return config;
    }

    // Insert signingConfigs block before buildTypes
    const signingConfigBlock = `
    def releaseSigningProps = new Properties()
    def releaseSigningFile = rootProject.file("../secrets/.env.signing")
    if (releaseSigningFile.exists()) {
        releaseSigningFile.withInputStream { releaseSigningProps.load(it) }
    }

    def resolveReleaseSigning = { key, defaultValue = null ->
        def envValue = System.getenv(key)
        if (envValue != null && envValue.length() > 0) {
            return envValue
        }

        def fileValue = releaseSigningProps.getProperty(key)
        if (fileValue != null && fileValue.length() > 0) {
            return fileValue
        }

        return defaultValue
    }

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def releaseStoreFile = resolveReleaseSigning('CHARTSIGNL_RELEASE_STORE_FILE', 'chartsignl-release.keystore')
            def releaseKeyAlias = resolveReleaseSigning('CHARTSIGNL_RELEASE_KEY_ALIAS', 'chartsignl')
            def releaseStorePassword = resolveReleaseSigning('CHARTSIGNL_RELEASE_STORE_PASSWORD')
            def releaseKeyPassword = resolveReleaseSigning('CHARTSIGNL_RELEASE_KEY_PASSWORD')

            if (!releaseStorePassword || !releaseKeyPassword) {
                throw new GradleException("Release signing credentials not configured. Set CHARTSIGNL_RELEASE_* environment variables or create apps/mobile/secrets/.env.signing")
            }
            storeFile file(releaseStoreFile)
            storePassword releaseStorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
        }
    }`;

    if (buildGradle.includes("buildTypes {")) {
      config.modResults.contents = buildGradle.replace(
        "buildTypes {",
        `${signingConfigBlock}\n\n    buildTypes {`
      );
    }

    // Wire release signing config + hardening flags into release buildType only
    // (must not match the release block inside signingConfigs above)
    const contents = config.modResults.contents;
    if (!contents.includes("signingConfig signingConfigs.release")) {
      // Replace release buildType: remove default signingConfig signingConfigs.debug and add release signing + flags
      config.modResults.contents = contents.replace(
        /(buildTypes\s*\{\s*debug\s*\{[^}]*\}\s*release\s*\{)\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*signingConfig signingConfigs\.debug/,
        `$1
            signingConfig signingConfigs.release
            debuggable false
            jniDebuggable false`
      );
    }

    return config;
  });
}

// Compose both mods: copy keystore file, then inject signing config
function withReleaseSigning(config) {
  config = withKeystoreCopy(config);
  config = withSigningConfig(config);
  return config;
}

module.exports = withReleaseSigning;
