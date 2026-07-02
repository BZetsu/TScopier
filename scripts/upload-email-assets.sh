#!/usr/bin/env bash
# Upload brand images to the public email-assets Storage bucket.
# Requires: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" && -f worker/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source worker/.env
  set +a
fi

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
BUCKET="email-assets"

if [[ -z "$SUPABASE_URL" || -z "$SERVICE_KEY" ]]; then
  echo "error: set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY" >&2
  echo "hint: add them to TScopier/.env or export before running" >&2
  exit 1
fi

upload_file() {
  local path="$1"
  local object_name="$2"
  local content_type="$3"

  if [[ ! -f "$path" ]]; then
    echo "error: missing file $path" >&2
    exit 1
  fi

  echo "Uploading ${object_name}..."
  curl -sf -X POST "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${object_name}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: ${content_type}" \
    -H "x-upsert: true" \
    --data-binary @"${path}" \
    -o /dev/null
  echo "  → ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${object_name}"
}

upload_file "${ROOT}/public/tscopierlogo.png" "tscopierlogo.png" "image/png"
upload_file "${ROOT}/public/tscopierlogo-dark.png" "tscopierlogo-dark.png" "image/png"
upload_file "${ROOT}/public/tslogo-collapse.png" "tslogo-collapse.png" "image/png"
upload_file "${ROOT}/public/favicon.svg" "favicon.svg" "image/svg+xml"

echo ""
echo "Done. Edge functions use SUPABASE_URL + /storage/v1/object/public/${BUCKET}/…"
