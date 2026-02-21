#!/usr/bin/env node

/**
 * prebuild.js
 *
 * Wrapper around `npx expo prebuild --clean` that handles the full lifecycle:
 * 1. Validates secrets/ exists with keystore + credentials
 * 2. Runs expo prebuild --clean
 * 3. Verifies all config plugins injected correctly
 *
 * Usage: node scripts/prebuild.js [--platform android|ios|all]
 * Run from: apps/mobile/
 *
 * Why this exists:
 * `prebuild --clean` deletes android/ entirely. The keystore file and all
 * native customizations would be lost. Config plugins re-inject the config,
 * and the withReleaseSigning plugin copies the keystore from secrets/.
 * This script just orchestrates and validates the process.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, ".."); // apps/mobile
const SECRETS_DIR = path.join(PROJECT_ROOT, "secrets");
const KEYSTORE_SRC = path.join(SECRETS_DIR, "chartsignl-release.keystore");
const ENV_SIGNING = path.join(SECRETS_DIR, ".env.signing");
const VERIFY_SCRIPT = path.join(PROJECT_ROOT, "plugins", "verify-prebuild.js");

// Parse args
const args = process.argv.slice(2);
const platformIdx = args.indexOf("--platform");
const platform = platformIdx >= 0 ? args[platformIdx + 1] : "android";

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  try {
    execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      ...opts,
    });
  } catch (err) {
    fail(`Command failed: ${cmd}`);
  }
}

// ─── Pre-flight checks ───────────────────────────────────────────

console.log("\n🔧 ChartSignl Prebuild\n");

// Check secrets directory exists
if (!fs.existsSync(SECRETS_DIR)) {
  fail(
    `secrets/ directory not found.\n` +
    `   Run: node scripts/setup-signing.js`
  );
}

// Check keystore
if (!fs.existsSync(KEYSTORE_SRC)) {
  fail(
    `Keystore not found at secrets/chartsignl-release.keystore\n` +
    `   Run: node scripts/setup-signing.js`
  );
}
log("✅", "Keystore found in secrets/");

// Check .env.signing
if (!fs.existsSync(ENV_SIGNING)) {
  fail(
    `.env.signing not found in secrets/\n` +
    `   Run: node scripts/setup-signing.js`
  );
}

// Validate that passwords are actually set
const envContents = fs.readFileSync(ENV_SIGNING, "utf-8");
if (
  !envContents.includes("CHARTSIGNL_RELEASE_STORE_PASSWORD=") ||
  envContents.includes("CHARTSIGNL_RELEASE_STORE_PASSWORD=\n") ||
  envContents.includes("CHARTSIGNL_RELEASE_STORE_PASSWORD=\r")
) {
  fail(
    `CHARTSIGNL_RELEASE_STORE_PASSWORD is empty in secrets/.env.signing\n` +
    `   Run: node scripts/setup-signing.js`
  );
}
log("✅", "Signing credentials found in secrets/.env.signing");

// ─── Run prebuild ─────────────────────────────────────────────────

console.log("");
log("🚀", `Running expo prebuild --clean --platform ${platform}...\n`);

run(`npx expo prebuild --clean --platform ${platform}`);

console.log("");
log("✅", "Prebuild complete");

// ─── Restore local.properties (SDK path, wiped by --clean) ────────
if (platform === "android" || platform === "all") {
  const localPropsPath = path.join(PROJECT_ROOT, "android", "local.properties");
  const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "C:\\Users\\Art\\AppData\\Local\\Android\\Sdk";
  fs.writeFileSync(localPropsPath, `sdk.dir=${sdkDir.replace(/\\/g, "\\\\")}\n`);
  log("✅", "Restored android/local.properties");
}

// ─── Verify ───────────────────────────────────────────────────────

if (platform === "android" || platform === "all") {
  console.log("");
  log("🔍", "Running verification...\n");

  try {
    execSync(`node ${VERIFY_SCRIPT}`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
  } catch (err) {
    // verify-prebuild.js exits with code 1 on failure
    fail(
      "Verification failed! Some config plugins may not have injected correctly.\n" +
      "   Check the output above for details."
    );
  }
}

// ─── Done ─────────────────────────────────────────────────────────

console.log("");
log("🎉", "Prebuild complete and verified!");
console.log("");
console.log("   Next steps:");
console.log("   • npx expo run:android        (dev build)");
console.log("   • cd android && ./gradlew bundleRelease  (release AAB)");
console.log("");
