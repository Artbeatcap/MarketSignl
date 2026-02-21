#!/usr/bin/env node

/**
 * setup-signing.js
 *
 * Interactive setup for Android release signing.
 * Creates the secrets/ directory structure and .env.signing file.
 *
 * Usage: node scripts/setup-signing.js
 * Run from: apps/mobile/
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SECRETS_DIR = path.join(__dirname, "..", "secrets");
const ENV_SIGNING_PATH = path.join(SECRETS_DIR, ".env.signing");
const KEYSTORE_DEST = path.join(SECRETS_DIR, "chartsignl-release.keystore");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function main() {
  console.log("\n🔐 ChartSignl Android Signing Setup\n");
  console.log("This will create the secrets/ directory with your keystore");
  console.log("configuration. secrets/ is gitignored and never deleted by prebuild.\n");

  // Create secrets directory
  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
    console.log("📁 Created secrets/ directory\n");
  }

  // Check for existing keystore
  if (fs.existsSync(KEYSTORE_DEST)) {
    console.log("✅ Keystore already exists at secrets/chartsignl-release.keystore\n");
  } else {
    // Check common locations
    const possibleLocations = [
      path.join(__dirname, "..", "android", "app", "chartsignl-release.keystore"),
      path.join(__dirname, "..", "..", "android", "app", "chartsignl-release.keystore"), // monorepo: android at repo root
      path.join(__dirname, "..", "chartsignl-release.keystore"),
      path.join(__dirname, "..", "..", "..", "chartsignl-release.keystore"),
    ];

    let foundAt = null;
    for (const loc of possibleLocations) {
      if (fs.existsSync(loc)) {
        foundAt = loc;
        break;
      }
    }

    if (foundAt) {
      console.log(`📋 Found keystore at: ${path.relative(process.cwd(), foundAt)}`);
      const copy = await ask("Copy it to secrets/? (y/n)", "y");
      if (copy.toLowerCase() === "y") {
        fs.copyFileSync(foundAt, KEYSTORE_DEST);
        console.log("✅ Keystore copied to secrets/\n");
      }
    } else {
      console.log("⚠️  No keystore file found.");
      console.log("   You need to either:");
      console.log("   1. Copy your existing keystore to: secrets/chartsignl-release.keystore");
      console.log("   2. Generate a new one (see DEPLOY.md)\n");

      const keystorePath = await ask(
        "Enter path to your keystore file (or press Enter to skip)"
      );
      if (keystorePath && fs.existsSync(keystorePath)) {
        fs.copyFileSync(keystorePath, KEYSTORE_DEST);
        console.log("✅ Keystore copied to secrets/\n");
      } else if (keystorePath) {
        console.log(`❌ File not found: ${keystorePath}\n`);
      }
    }
  }

  // Create .env.signing
  console.log("Now let's set up your signing passwords.\n");

  const existingEnv = {};
  if (fs.existsSync(ENV_SIGNING_PATH)) {
    const lines = fs.readFileSync(ENV_SIGNING_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) existingEnv[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
    console.log("📋 Found existing .env.signing — will use current values as defaults.\n");
  }

  const alias = await ask(
    "Key alias",
    existingEnv.CHARTSIGNL_RELEASE_KEY_ALIAS || "chartsignl"
  );
  const storePassword = await ask(
    "Keystore password",
    existingEnv.CHARTSIGNL_RELEASE_STORE_PASSWORD || ""
  );
  const keyPassword = await ask(
    "Key password (same as keystore password if PKCS12)",
    existingEnv.CHARTSIGNL_RELEASE_KEY_PASSWORD || storePassword
  );

  const envContent = `# ChartSignl Android Release Signing
# This file is gitignored. NEVER commit this.
# For CI/CD, set these as environment variables instead.

CHARTSIGNL_RELEASE_KEY_ALIAS=${alias}
CHARTSIGNL_RELEASE_STORE_PASSWORD=${storePassword}
CHARTSIGNL_RELEASE_KEY_PASSWORD=${keyPassword}
`;

  fs.writeFileSync(ENV_SIGNING_PATH, envContent);
  console.log("\n✅ Created secrets/.env.signing\n");

  // Create a .gitkeep in case secrets/ is empty
  const gitkeepPath = path.join(SECRETS_DIR, ".gitkeep");
  if (!fs.existsSync(gitkeepPath)) {
    // Don't create .gitkeep — the whole dir is gitignored anyway
  }

  // Summary
  console.log("═══════════════════════════════════════════");
  console.log("📋 Summary");
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log(`  secrets/`);
  console.log(
    `    chartsignl-release.keystore  ${
      fs.existsSync(KEYSTORE_DEST) ? "✅" : "❌ MISSING"
    }`
  );
  console.log(`    .env.signing                 ✅`);
  console.log("");
  console.log("  These files are used by config plugins during prebuild.");
  console.log("  They are gitignored and safe on your local machine.");
  console.log("");

  if (fs.existsSync(KEYSTORE_DEST)) {
    console.log("  Before running prebuild, confirm the keystore is in place (from repo root):");
    console.log("    dir apps\\mobile\\secrets\\chartsignl-release.keystore");
    console.log("");
  }

  if (!fs.existsSync(KEYSTORE_DEST)) {
    console.log("  ⚠️  NEXT STEP: Copy your keystore file to:");
    console.log(`     ${KEYSTORE_DEST}`);
    console.log("");
  }

  console.log("  To test: npx expo prebuild --clean --platform android");
  console.log("           node plugins/verify-prebuild.js");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  rl.close();
  process.exit(1);
});
