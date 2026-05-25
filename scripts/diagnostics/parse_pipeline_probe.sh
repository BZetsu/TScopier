#!/usr/bin/env bash
# Parse pipeline probe — verify Telethon → trade worker /internal/parse-signal bridge.
# Usage:
#   TRADE_WORKER_URL=https://trade.up.railway.app \
#   WORKER_INTERNAL_TOKEN=secret \
#   CHANNEL_ROW_ID=uuid USER_ID=uuid \
#   MESSAGE='BUY XAUUSD NOW SL 2650 TP 2700' \
#   ./scripts/diagnostics/parse_pipeline_probe.sh
#
# Optional: pass multiple channel IDs comma-separated in CHANNEL_ROW_IDS

set -euo pipefail

TRADE_URL="${TRADE_WORKER_URL:-${TRADE_URL:-}}"
TOKEN="${WORKER_INTERNAL_TOKEN:-}"
USER_ID="${USER_ID:-}"
CHANNEL_ROW_ID="${CHANNEL_ROW_ID:-}"
CHANNEL_ROW_IDS="${CHANNEL_ROW_IDS:-$CHANNEL_ROW_ID}"
MESSAGE="${MESSAGE:-BUY XAUUSD NOW SL 2650 TP 2700}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ -z "$TRADE_URL" ]]; then
  red "Set TRADE_WORKER_URL (or TRADE_URL)"
  exit 1
fi
if [[ -z "$TOKEN" ]]; then
  red "Set WORKER_INTERNAL_TOKEN"
  exit 1
fi
if [[ -z "$USER_ID" ]]; then
  yellow "USER_ID not set — shard check may return wrong_shard"
fi
if [[ -z "$CHANNEL_ROW_IDS" ]]; then
  red "Set CHANNEL_ROW_ID or CHANNEL_ROW_IDS (comma-separated UUIDs)"
  exit 1
fi

BASE="${TRADE_URL%/}"

echo "=== Trade worker health: $BASE/health ==="
health_body="$(curl -sS -w '\n%{http_code}' "$BASE/health" 2>/dev/null || true)"
health_code="$(echo "$health_body" | tail -n1)"
health_json="$(echo "$health_body" | sed '$d')"
echo "$health_json" | jq . 2>/dev/null || echo "$health_json"
if [[ "$health_code" != "200" ]]; then
  red "Trade worker health HTTP $health_code — fix before parse probe"
  exit 1
fi
echo

IFS=',' read -ra IDS <<< "$CHANNEL_ROW_IDS"
for cid in "${IDS[@]}"; do
  cid="$(echo "$cid" | xargs)"
  [[ -z "$cid" ]] && continue
  echo "=== parse-signal channel_row_id=$cid ==="
  payload="$(jq -n \
    --arg channel_row_id "$cid" \
    --arg raw_message "$MESSAGE" \
    --arg user_id "$USER_ID" \
    '{channel_row_id: $channel_row_id, raw_message: $raw_message, user_id: ($user_id | select(length > 0))}')"
  result="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/internal/parse-signal" \
    -H "Content-Type: application/json" \
    -H "x-internal-token: $TOKEN" \
    -d "$payload" 2>/dev/null || true)"
  code="$(echo "$result" | tail -n1)"
  body="$(echo "$result" | sed '$d')"
  echo "$body" | jq . 2>/dev/null || echo "$body"
  status="$(echo "$body" | jq -r '.status // empty' 2>/dev/null || true)"
  reason="$(echo "$body" | jq -r '.skip_reason // .reason // .error // empty' 2>/dev/null || true)"
  if [[ "$code" == "200" && "$status" == "parsed" ]]; then
    green "HTTP $code status=parsed action=$(echo "$body" | jq -r '.parsed.action // empty')"
  elif [[ "$code" == "200" ]]; then
    yellow "HTTP $code status=$status reason=$reason"
  else
    red "HTTP $code — parse bridge failed"
  fi
  echo
done

yellow "Next: run query #9–#12 in scripts/diagnostics/multi_user_channel_copy.sql"
yellow "Local replay: ./scripts/diagnostics/replay_channel_parse.sh --channel-id UUID --message '...'"
