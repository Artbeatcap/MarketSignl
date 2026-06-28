# Complete workflow: Download .env, edit in Notepad, then upload and restart
$SERVER = "root@167.88.43.61"
$REMOTE_ENV_PATH = "/root/ChartSignl/apps/backend/deploy/.env"
$LOCAL_ENV_FILE = "remote.env"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ChartSignl .env Editor Workflow" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: Download
Write-Host "Step 1: Downloading .env file from server..." -ForegroundColor Yellow
scp "${SERVER}:${REMOTE_ENV_PATH}" $LOCAL_ENV_FILE

if (-not (Test-Path $LOCAL_ENV_FILE)) {
    Write-Host "❌ Download failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ File downloaded successfully!" -ForegroundColor Green
Write-Host ""

# Step 2: Open in Notepad
Write-Host "Step 2: Opening in Notepad..." -ForegroundColor Yellow
Write-Host "  → Edit the file and save when done" -ForegroundColor Gray
Write-Host "  → Close Notepad to continue" -ForegroundColor Gray
Write-Host ""

$notepad = Start-Process notepad -ArgumentList $LOCAL_ENV_FILE -PassThru -Wait

Write-Host ""
Write-Host "Notepad closed. Proceeding to upload..." -ForegroundColor Yellow
Write-Host ""

# Step 3: Upload and restart
Write-Host "Step 3: Uploading .env file to server..." -ForegroundColor Yellow
scp $LOCAL_ENV_FILE "${SERVER}:${REMOTE_ENV_PATH}"

Write-Host "Recreating Docker container to apply env changes..." -ForegroundColor Yellow
ssh $SERVER 'cd /root/ChartSignl/apps/backend/deploy && docker compose up -d --force-recreate chartsignl-api'

Write-Host "Waiting for container to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "Checking container health..." -ForegroundColor Yellow
ssh $SERVER 'curl -f http://localhost:4000/health 2>&1' | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Container is healthy!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Health check failed. Container may still be starting." -ForegroundColor Yellow
    Write-Host "Check logs with: ssh $SERVER 'cd /root/ChartSignl/apps/backend/deploy && docker-compose logs --tail=50'" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ .env file updated and container restarted!" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
