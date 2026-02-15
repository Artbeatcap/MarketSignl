# Update STRIPE_PRICE_ID on production server to the LIVE price ID.
# Usage: .\update-server-stripe-price.ps1 -LivePriceId "price_xxxxx"
# Get the live price ID from: Stripe Dashboard (switch to Live mode) -> Product catalog -> your product -> Price ID

param(
    [Parameter(Mandatory=$true)]
    [string]$LivePriceId
)

$SERVER = "root@167.88.43.61"
$ENV_PATH = "/root/ChartSignl/.env"

if ($LivePriceId -notmatch '^price_[a-zA-Z0-9]+$') {
    Write-Host "Error: LivePriceId should look like price_xxxxx" -ForegroundColor Red
    exit 1
}

Write-Host "Updating STRIPE_PRICE_ID on server to: $LivePriceId" -ForegroundColor Yellow
$cmd = "sed -i 's/^STRIPE_PRICE_ID=.*/STRIPE_PRICE_ID=$LivePriceId/' $ENV_PATH && grep STRIPE_PRICE_ID $ENV_PATH"
ssh $SERVER $cmd
if ($LASTEXITCODE -eq 0) {
    Write-Host "Restarting backend container..." -ForegroundColor Yellow
    ssh $SERVER "cd /root/ChartSignl/apps/backend/deploy && docker-compose up -d --force-recreate chartsignl-api"
    Write-Host "Done. Backend restarted." -ForegroundColor Green
} else {
    Write-Host "Update or restart failed." -ForegroundColor Red
    exit 1
}
