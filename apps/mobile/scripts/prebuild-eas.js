#!/usr/bin/env node
/**
 * EAS prebuild hook — Android-only FCM file copy.
 * Skips on iOS (no google-services.json needed).
 */
const { execSync } = require("child_process");
const path = require("path");

const platform = process.env.EAS_BUILD_PLATFORM;
if (platform === "ios") {
  console.log("prebuild-eas: skipping google-services copy on iOS");
  process.exit(0);
}

const projectRoot = path.join(__dirname, "..");
execSync("node scripts/copy-google-services.js", {
  cwd: projectRoot,
  stdio: "inherit",
});
