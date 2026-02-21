#!/usr/bin/env node

/**
 * verify-prebuild.js
 *
 * Run after `npx expo prebuild --clean` (or `node scripts/prebuild.js`)
 * to verify all config plugins injected their customizations correctly.
 *
 * Usage: node plugins/verify-prebuild.js
 * Run from: apps/mobile/
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const ANDROID_ROOT = path.join(PROJECT_ROOT, "android");
const SECRETS_DIR = path.join(PROJECT_ROOT, "secrets");

const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";
const WARN = "\x1b[33m⚠️  WARN\x1b[0m";

let failures = 0;
let warnings = 0;

function check(label, filePath, searchString) {
  const fullPath = path.join(ANDROID_ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`${FAIL} ${label} — file not found: ${filePath}`);
    failures++;
    return;
  }
  const contents = fs.readFileSync(fullPath, "utf-8");
  if (contents.includes(searchString)) {
    console.log(`${PASS} ${label}`);
  } else {
    console.log(`${FAIL} ${label} — "${searchString}" not found in ${filePath}`);
    failures++;
  }
}

function checkExists(label, absolutePath, hint) {
  if (fs.existsSync(absolutePath)) {
    console.log(`${PASS} ${label}`);
  } else {
    console.log(`${FAIL} ${label}`);
    if (hint) console.log(`       → ${hint}`);
    failures++;
  }
}

function warn(label, absolutePath, hint) {
  if (fs.existsSync(absolutePath)) {
    console.log(`${PASS} ${label}`);
  } else {
    console.log(`${WARN} ${label}`);
    if (hint) console.log(`       → ${hint}`);
    warnings++;
  }
}

console.log("\n🔍 Verifying prebuild customizations...\n");

// ─── Section 1: Secrets (source of truth) ─────────────────────────
console.log("── Secrets Directory ──────────────────────────");

checkExists(
  "secrets/ directory exists",
  SECRETS_DIR,
  "Run: node scripts/setup-signing.js"
);

checkExists(
  "Keystore source file (secrets/chartsignl-release.keystore)",
  path.join(SECRETS_DIR, "chartsignl-release.keystore"),
  "Copy your keystore to secrets/chartsignl-release.keystore"
);

checkExists(
  "Signing credentials (secrets/.env.signing)",
  path.join(SECRETS_DIR, ".env.signing"),
  "Run: node scripts/setup-signing.js"
);

console.log("");

// ─── Section 2: Generated Android files ───────────────────────────
console.log("── Generated Android Files ────────────────────");

// AndroidManifest.xml
check(
  "App Links intent filter (chartsignl.com)",
  "app/src/main/AndroidManifest.xml",
  "chartsignl.com"
);
check(
  "Billing permission",
  "app/src/main/AndroidManifest.xml",
  "com.android.vending.BILLING"
);
check(
  "Custom scheme (chartsignl://)",
  "app/src/main/AndroidManifest.xml",
  'android:scheme="chartsignl"'
);

// build.gradle (app)
check(
  "Release signing config",
  "app/build.gradle",
  "CHARTSIGNL_RELEASE_STORE_FILE"
);
check(
  "Play Billing Library dependency",
  "app/build.gradle",
  "com.android.billingclient:billing"
);
check(
  "resConfigs English only",
  "app/build.gradle",
  "resConfigs"
);
check(
  "Release build hardening (debuggable false)",
  "app/build.gradle",
  "debuggable false"
);

// gradle.properties
check(
  "Keystore store file property",
  "gradle.properties",
  "CHARTSIGNL_RELEASE_STORE_FILE"
);
check(
  "Keystore alias property",
  "gradle.properties",
  "CHARTSIGNL_RELEASE_KEY_ALIAS"
);
check(
  "Keystore store password set",
  "gradle.properties",
  "CHARTSIGNL_RELEASE_STORE_PASSWORD"
);
check(
  "Architecture filter (64-bit only)",
  "gradle.properties",
  "arm64-v8a"
);

// proguard-rules.pro
check(
  "Reanimated ProGuard rule",
  "app/proguard-rules.pro",
  "com.swmansion.reanimated"
);
check(
  "Turbomodule ProGuard rule",
  "app/proguard-rules.pro",
  "com.facebook.react.turbomodule"
);

// colors.xml
check(
  "Custom colorPrimary (#023c69)",
  "app/src/main/res/values/colors.xml",
  "#023c69"
);
check(
  "Splash screen background (#F0F9F9)",
  "app/src/main/res/values/colors.xml",
  "#F0F9F9"
);

console.log("");

// ─── Section 3: Keystore copied into android/ ─────────────────────
console.log("── Keystore in Build Directory ────────────────");

checkExists(
  "Keystore copied to android/app/",
  path.join(ANDROID_ROOT, "app", "chartsignl-release.keystore"),
  "The withReleaseSigning plugin should copy this automatically from secrets/"
);

// Verify password is not empty in gradle.properties
const gradlePropsPath = path.join(ANDROID_ROOT, "gradle.properties");
if (fs.existsSync(gradlePropsPath)) {
  const gradleProps = fs.readFileSync(gradlePropsPath, "utf-8");
  const passwordMatch = gradleProps.match(
    /CHARTSIGNL_RELEASE_STORE_PASSWORD=(.+)/
  );
  if (passwordMatch && passwordMatch[1].trim().length > 0) {
    console.log(`${PASS} Keystore password is non-empty in gradle.properties`);
  } else {
    console.log(`${FAIL} Keystore password appears empty in gradle.properties`);
    console.log(
      "       → Check secrets/.env.signing or set CHARTSIGNL_RELEASE_STORE_PASSWORD env var"
    );
    failures++;
  }
}

console.log("");

// ─── Summary ──────────────────────────────────────────────────────
console.log("═".repeat(50));
if (failures === 0 && warnings === 0) {
  console.log("\x1b[32m🎉 All checks passed! Ready to build.\x1b[0m\n");
} else if (failures === 0) {
  console.log(
    `\x1b[33m⚠️  All critical checks passed, but ${warnings} warning(s). Review above.\x1b[0m\n`
  );
} else {
  console.log(
    `\x1b[31m❌ ${failures} check(s) failed. Review the output above.\x1b[0m\n`
  );
  process.exit(1);
}
