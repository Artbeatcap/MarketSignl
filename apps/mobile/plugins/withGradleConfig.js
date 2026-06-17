/**
 * withGradleConfig
 *
 * Injects into android/:
 * - gradle.properties: architecture filter, SDK versions
 * - build.gradle (root): ext block so subprojects (expo-modules-core, etc.) see compileSdkVersion
 *
 * Release signing secrets are intentionally not written to gradle.properties.
 * withReleaseSigning resolves them at Gradle build time from environment
 * variables or apps/mobile/secrets/.env.signing.
 */
const { withGradleProperties, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ROOT_EXT_BLOCK = `
// Expose SDK versions to subprojects (expo-modules-core, expo-asset, etc.)
// buildscript.ext is not visible to subprojects; rootProject.ext is.
ext {
    buildToolsVersion = findProperty('android.buildToolsVersion') ?: '35.0.0'
    minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '24')
    compileSdkVersion = Integer.parseInt(findProperty('android.compileSdkVersion') ?: '35')
    targetSdkVersion = Integer.parseInt(findProperty('android.targetSdkVersion') ?: '35')
    kotlinVersion = findProperty('android.kotlinVersion') ?: '2.0.21'
}
`;

function withGradleConfig(config) {
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;

    // Helper: set or update a gradle property
    function setProperty(key, value) {
      const existing = props.findIndex(
        (p) => p.type === "property" && p.key === key
      );
      if (existing >= 0) {
        props[existing].value = value;
      } else {
        props.push({ type: "property", key, value });
      }
    }

    // Remove any stale signing secrets that a previous prebuild may have written.
    const releaseSigningKeys = new Set([
      "CHARTSIGNL_RELEASE_STORE_FILE",
      "CHARTSIGNL_RELEASE_KEY_ALIAS",
      "CHARTSIGNL_RELEASE_STORE_PASSWORD",
      "CHARTSIGNL_RELEASE_KEY_PASSWORD",
    ]);
    for (let i = props.length - 1; i >= 0; i--) {
      if (props[i].type === "property" && releaseSigningKeys.has(props[i].key)) {
        props.splice(i, 1);
      }
    }

    // --- Architecture Filter ---
    // Drop 32-bit for 16KB page alignment compliance
    setProperty("reactNativeArchitectures", "arm64-v8a,x86_64");

    // --- Android SDK versions (Google Play requirement) ---
    setProperty("android.compileSdkVersion", "35");
    setProperty("android.targetSdkVersion", "35");
    setProperty("android.buildToolsVersion", "35.0.0");
    setProperty("android.kotlinVersion", "2.0.21");
    setProperty("android.minSdkVersion", "24");

    // Jetifier cannot handle Java 21 bytecode (e.g. bcprov-jdk18on); exclude from transform
    setProperty("android.jetifier.ignorelist", "bcprov-jdk18on");

    return config;
  });
  config = withRootBuildGradleExt(config);
  return config;
}

function withRootBuildGradleExt(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        "build.gradle"
      );
      let contents = await fs.promises.readFile(buildGradlePath, "utf-8");
      // Only inject once (idempotent)
      if (contents.includes("rootProject.ext") || contents.includes("// Expose SDK versions to subprojects")) {
        return config;
      }
      // Insert ext block after buildscript { } and before "apply plugin"
      const insertAfter = /(\}\s*\n\}\s*\n)(\s*apply plugin:)/;
      if (!insertAfter.test(contents)) {
        return config;
      }
      contents = contents.replace(
        insertAfter,
        `$1${ROOT_EXT_BLOCK}
$2`
      );
      await fs.promises.writeFile(buildGradlePath, contents);
      return config;
    },
  ]);
}

module.exports = withGradleConfig;
