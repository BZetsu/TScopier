#!/usr/bin/env bash
# Phase 0 triage helper — checks listener + trade /health and optional dispatch probe.
# Usage:
#   LISTENER_URL=https://listener.up.railway.app \
#   TRADE_URL=https://trade.up.railway.app \
#   WORKER_INTERNAL_TOKEN=secret \
#   ./scripts/diagnostics/phase0_triage.sh

set -euo pipefail

LISTENER_URL="${LISTENER_URL:-}"
TRADE_URL="${TRADE_URL:-}"
TOKEN="${WORKER_INTERNAL_TOKEN:-}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

check_health() {
  local name="$1"
  local url="$2"
  if [[ -z "$url" ]]; then
    yellow "SKIP $name — URL not set"
    return 0
  fi
  local base="${url%/}"
  echo "=== $name health: $base/health ==="
  local code body
  body="$(curl -sS -w '\n%{http_code}' "$base/health" 2>/dev/null || true)"
  code="$(echo "$body" | tail -n1)"
  body="$(echo "$body" | sed '$d')"
  echo "$body" | jq . 2>/dev/null || echo "$body"
  if [[ "$code" == "200" ]]; then
    local ok
    ok="$(echo "$body" | jq -r '.ok // empty' 2>/dev/null || true)"
    if [[ "$ok" == "true" ]]; then
      green "$name: HTTP $code, ok=true"
    else
      red "$name: HTTP $code but ok=$ok — investigate detail[] and metrics"
    fi
  else
    red "$name: HTTP $code"
  fi
  echo
}

check_health "Listener" "$LISTENER_URL"
check_health "Trade" "$TRADE_URL"

if [[ -n "$TRADE_URL" && -n "$TOKEN" ]]; then
  echo "=== Trade dispatch probe (ignore action — should accept or wrong_shard) ==="
  curl -sS -X POST "${TRADE_URL%/}/internal/dispatch-signal" \
    -H "Content-Type: application/json" \
    -H "x-internal-token: $TOKEN" \
    -d '{"signal":{"id":"00000000-0000-4000-8000-000000000099","user_id":"00000000-0000-4000-8000-000000000000","status":"parsed","parsed_data":{"action":"ignore"}},"source":"triage_probe","await":false}' \
    | jq . 2>/dev/null || true
  echo
else
  yellow "SKIP dispatch probe — set TRADE_URL and WORKER_INTERNAL_TOKEN"
fi

yellow "Next: run scripts/diagnostics/multi_user_channel_copy.sql in Supabase SQL Editor"
yellow "See docs/telegram-copier-triage.md for full runbook"
