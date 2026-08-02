#!/usr/bin/env node
/**
 * Copy google-services.json into android/app/ before native build.
 * Used by EAS prebuildCommand and local builds (bare workflow skips expo prebuild).
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const src = path.join(projectRoot, "google-services.json");
const dest = path.join(projectRoot, "android", "app", "google-services.json");

if (!fs.existsSync(src)) {
  console.error(
    "Missing apps/mobile/google-services.json — download from Firebase Console " +
      "(package com.optionsplungellc.chartsignl)."
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("google-services.json → android/app/");
