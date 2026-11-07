#!/usr/bin/env bash
# Smoke-test ChartSignl internal sniper routes (run on VPS or locally).
# Usage: INTERNAL_API_KEY=your-secret ./scripts/smoke_internal_signals.sh [base_url]

set -euo pipefail

BASE_URL="${1:-http://localhost:4000}"
KEY="${INTERNAL_API_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "ERROR: set INTERNAL_API_KEY" >&2
  exit 1
fi

echo "== health =="
curl -sf "$BASE_URL/health" | head -c 200
echo

echo "== unauthorized (expect 401) =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/internal/signal-analysis" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SPY","interval":"5m","data":[],"signal":{"side":"long","entry":500,"stop":495}}')
if [[ "$code" != "401" ]]; then
  echo "FAIL: expected 401, got $code" >&2
  exit 1
fi
echo "401 OK"

# 25 synthetic 5m bars (minimal fixture for indicator calc)
DATA='['
for i in $(seq 0 24); do
  ts=$((1700000000000 + i * 300000))
  price=$((50000 + i * 10))
  [[ $i -gt 0 ]] && DATA+=','
  DATA+="{\"timestamp\":$ts,\"date\":\"2023-11-14T10:0${i}:00.000Z\",\"open\":$((price-5)),\"high\":$((price+10)),\"low\":$((price-15)),\"close\":$price,\"volume\":1000000}"
done
DATA+=']'

echo "== signal-analysis =="
curl -sf -X POST "$BASE_URL/api/internal/signal-analysis" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: $KEY" \
  -d "{\"symbol\":\"SPY\",\"interval\":\"5m\",\"data\":$DATA,\"signal\":{\"side\":\"long\",\"entry\":500.5,\"stop\":495.0}}" \
  | head -c 500
echo

echo "== sniper-alert =="
curl -sf -X POST "$BASE_URL/api/internal/sniper-alert" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: $KEY" \
  -d '{"ticker":"SPY","tier":"t3","side":"long","alert_type":"day2_reclaim","entry":500.5,"stop":495.0,"levels":{"e200":498.0},"atlas":{"verdict":"supports","confidence":78},"slack_ts":"smoke-test-ts"}'
echo
echo "OK"
