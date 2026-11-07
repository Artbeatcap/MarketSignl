#!/bin/sh
set -eu
cd /root/ChartSignl/market-alerts/deploy
umask 077
if [ -f .env ]; then
  echo ENV_EXISTS
  exit 0
fi
key=$(openssl rand -hex 32)
cat > .env << EOF
N8N_HOST=localhost
N8N_PROTOCOL=http
WEBHOOK_URL=http://localhost:5679/
N8N_ENCRYPTION_KEY=${key}
GENERIC_TIMEZONE=America/New_York
TRANSCRIPT_TIMEZONE=America/New_York
TRANSCRIPT_PROVIDER=supadata
MONTHLY_TRANSCRIPT_LIMIT=100
HEALTHCHECK_TRANSCRIPTS_URL=
SLACK_ALERT_CHANNEL=
EOF
chmod 600 .env
awk -F= '/N8N_ENCRYPTION_KEY/{print "KEY_BYTES", length($2)}' .env
