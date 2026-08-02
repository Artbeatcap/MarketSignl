# Configure APNs and ship an iOS production build to TestFlight.
#
# Prerequisites (Apple Developer — manual):
# 1. Identifiers → com.optionsplungellc.chartsignl → enable Push Notifications
# 2. Keys → + → Apple Push Notifications service (APNs) → download .p8 (one-time)
# 3. Note Key ID and Team ID (TWTN5CG47N)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "=== iOS Push setup (TestFlight) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Before continuing, confirm in Apple Developer:" -ForegroundColor Yellow
Write-Host "  [ ] App ID com.optionsplungellc.chartsignl has Push Notifications enabled"
Write-Host "  [ ] You have an APNs Auth Key (.p8) with Key ID + Team ID TWTN5CG47N"
Write-Host ""

$confirm = Read-Host "Have you completed the Apple Developer steps? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
  Write-Host "Complete Apple Developer setup first, then re-run this script." -ForegroundColor Red
  Write-Host "https://developer.apple.com/account/resources/authkeys/list"
  exit 1
}

Write-Host ""
Write-Host "Uploading APNs key to EAS (interactive — choose production profile)..." -ForegroundColor Yellow
npx eas credentials --platform ios

Write-Host ""
Write-Host "Starting production iOS build..." -ForegroundColor Yellow
npx eas build --platform ios --profile production --non-interactive

Write-Host ""
Write-Host "Submitting latest build to TestFlight..." -ForegroundColor Yellow
npx eas submit --platform ios --profile production --latest --non-interactive

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "  1. App Store Connect → TestFlight → install on a physical iPhone"
Write-Host "  2. Log in → Profile → Push registration probe"
Write-Host "  3. POST https://api.chartsignl.com/api/test-alert (Test A)"
Write-Host "  4. npx tsx scripts/test-alert-trigger.ts you@email.com SPY 650 (Test B)"
