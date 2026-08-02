# Configure FCM and trigger an Android build with push support.
# Prerequisite: copy google-services.json from Firebase Console to this folder.
#
# Firebase: create Android app with package com.optionsplungellc.chartsignl
# Then: cp google-services.json.example -> google-services.json (fill from console)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path "google-services.json")) {
  Write-Host "Missing apps/mobile/google-services.json" -ForegroundColor Red
  Write-Host "Download from Firebase Console and save as google-services.json"
  Write-Host "See google-services.json.example for package name."
  exit 1
}

Write-Host "Copying google-services.json into android/app/..." -ForegroundColor Yellow
node scripts/copy-google-services.js

Write-Host "Uploading FCM credentials to EAS (interactive)..." -ForegroundColor Yellow
Write-Host "  Use Firebase Console > Project settings > Service accounts > Generate new private key" -ForegroundColor Gray
npx eas credentials --platform android

Write-Host "Starting preview APK build..." -ForegroundColor Yellow
npx eas build --platform android --profile preview --non-interactive

Write-Host "Install the APK on your device, log in, run Push probe from Profile." -ForegroundColor Green
