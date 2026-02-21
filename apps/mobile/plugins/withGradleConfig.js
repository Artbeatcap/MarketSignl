/**
 * withGradleConfig
 *
 * Injects into android/:
 * - gradle.properties: keystore config, architecture filter, SDK versions
 * - build.gradle (root): ext block so subprojects (expo-modules-core, etc.) see compileSdkVersion
 *
 * Password resolution order (most secure first):
 * 1. Environment variables (CI/CD)
 * 2. secrets/.env.signing file (local dev)
 * 3. Throws error if neither found
 */
const { withGradleProperties, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ROOT_EXT_BLOCK = `
// Expose SDK versions to subprojects (expo-modules-core, expo-asset, etc.)
// buildscript.ext is not visible to subprojects; rootProject.ext is.
ext {
    buildToolsVersion = findProperty('android.buildToolsVersion') ?: '35.0.0'
    minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '23')
    compileSdkVersion = Integer.parseInt(findProperty('android.compileSdkVersion') ?: '35')
    targetSdkVersion = Integer.parseInt(findProperty('android.targetSdkVersion') ?: '35')
    kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.23'
    ndkVersion = "26.1.10909125"
}
`;

/**
 * Parse a simple KEY=VALUE .env file. Handles quotes and comments.
 */
function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }
  return vars;
}

function withGradleConfig(config) {
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;
    const projectRoot = config.modRequest.projectRoot; // apps/mobile

    // Load secrets from .env.signing if it exists
    const envSigningPath = path.join(projectRoot, "secrets", ".env.signing");
    const secretsEnv = parseEnvFile(envSigningPath);

    // Resolve a value: env var → secrets file → fallback
    function resolve(envKey, fallback) {
      return process.env[envKey] || secretsEnv[envKey] || fallback || "";
    }

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

    // --- Keystore file & alias ---
    setProperty("CHARTSIGNL_RELEASE_STORE_FILE", "chartsignl-release.keystore");
    setProperty(
      "CHARTSIGNL_RELEASE_KEY_ALIAS",
      resolve("CHARTSIGNL_RELEASE_KEY_ALIAS", "chartsignl")
    );

    // --- Passwords ---
    const storePassword = resolve("CHARTSIGNL_RELEASE_STORE_PASSWORD");
    const keyPassword = resolve("CHARTSIGNL_RELEASE_KEY_PASSWORD");

    if (!storePassword || !keyPassword) {
      console.warn(
        "\n  ⚠️  Keystore passwords not found!\n" +
        "     Set environment variables or create secrets/.env.signing\n" +
        "     Run: node scripts/setup-signing.js\n"
      );
    }

    setProperty("CHARTSIGNL_RELEASE_STORE_PASSWORD", storePassword);
    setProperty("CHARTSIGNL_RELEASE_KEY_PASSWORD", keyPassword);

    // --- Architecture Filter ---
    // Drop 32-bit for 16KB page alignment compliance
    setProperty("reactNativeArchitectures", "arm64-v8a,x86_64");

    // --- Android SDK versions (Google Play requirement) ---
    setProperty("android.compileSdkVersion", "35");
    setProperty("android.targetSdkVersion", "35");
    setProperty("android.buildToolsVersion", "35.0.0");

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
