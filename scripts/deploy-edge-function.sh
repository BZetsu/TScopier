#!/usr/bin/env bash
# Deploy Supabase Edge Functions from the app root (directory containing supabase/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f supabase/functions/parse-signal/index.ts ]]; then
  echo "error: run from TScopier app root (expected supabase/functions/parse-signal/index.ts)" >&2
  echo "hint: cd TScopier && ./scripts/deploy-edge-function.sh <function-name>" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <function-name> [extra supabase functions deploy flags...]" >&2
  echo "example: $0 parse-signal" >&2
  exit 1
fi

FN="$1"
shift
exec supabase functions deploy "$FN" --use-api "$@"
