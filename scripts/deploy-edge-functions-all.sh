#!/usr/bin/env bash
###############################################################################
# deploy-edge-functions-all.sh
#
# Deploys one or more Supabase Edge Functions to ALL accessible Supabase
# projects. Useful for propagating shared backend code (migration edge
# functions, admin functions) across staging and production environments.
#
# Usage:
#   ./scripts/deploy-edge-functions-all.sh <function-name> [...more-names]
#
# Examples:
#   ./scripts/deploy-edge-functions-all.sh redeem-recovery-code
#   ./scripts/deploy-edge-functions-all.sh admin-mutate admin-query
#   ./scripts/deploy-edge-functions-all.sh redeem-recovery-code admin-mutate admin-query
#
# Requires:
#   - supabase CLI (v2+) authenticated (supabase login)
#   - Access token at ~/.supabase/access-token
#
# Behavior:
#   1. Lists all Supabase projects accessible to the authenticated token.
#   2. For each project: links locally (temporarily), deploys the function(s),
#      then restores the original link (if any).
#   3. Reports per-project success/failure.
###############################################################################
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <function-name> [...more-names]" >&2
  echo "example: $0 redeem-recovery-code admin-mutate admin-query" >&2
  exit 1
fi

FUNCTIONS=("$@")

# ---------------------------------------------------------------------------
# Helper: run a command and capture output
# ---------------------------------------------------------------------------
run() {
  echo "  $ $*"
  "$@"
}

# ---------------------------------------------------------------------------
# Determine current linked project (if any) so we can restore it later
# ---------------------------------------------------------------------------
ORIGINAL_LINK=$(supabase status 2>/dev/null | grep -oP 'Project ref: \K\S+' || true)
if [[ -n "${ORIGINAL_LINK}" ]]; then
  echo "Original project link: ${ORIGINAL_LINK}"
else
  echo "No project currently linked."
fi

# ---------------------------------------------------------------------------
# Discover all accessible Supabase projects via the API
# ---------------------------------------------------------------------------
TOKEN_FILE="${HOME}/.supabase/access-token"
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "error: Supabase access token not found at ${TOKEN_FILE}" >&2
  echo "Run: supabase login" >&2
  exit 1
fi
TOKEN=$(cat "${TOKEN_FILE}")

echo "Fetching accessible Supabase projects..."
PROJECTS_JSON=$(curl -s "https://api.supabase.com/v1/projects" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

if ! echo "${PROJECTS_JSON}" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "error: failed to parse projects list from Supabase API" >&2
  echo "${PROJECTS_JSON}" | head -5 >&2
  exit 1
fi

PROJECT_REFS=$(echo "${PROJECTS_JSON}" | python3 -c "
import json,sys
data = json.load(sys.stdin)
if isinstance(data, dict) and 'projects' in data:
    items = data['projects']
elif isinstance(data, list):
    items = data
else:
    items = []
for p in items:
    print(p.get('ref') or p.get('id'))
")

if [[ -z "${PROJECT_REFS}" ]]; then
  echo "error: no accessible Supabase projects found" >&2
  exit 1
fi

echo "Found $(echo "${PROJECT_REFS}" | wc -l) project(s):"
echo "${PROJECT_REFS}" | sed 's/^/  - /'

# ---------------------------------------------------------------------------
# Deploy to each project
# ---------------------------------------------------------------------------
FAILED=()
SUCCESS=()

for REF in ${PROJECT_REFS}; do
  echo ""
  echo "============================================================"
  echo "Deploying to project: ${REF}"
  echo "============================================================"

  # Link to this project
  if ! supabase link --project-ref "${REF}" >/dev/null 2>&1; then
    echo "  [SKIP] Could not link to ${REF}"
    FAILED+=("${REF}: link-failed")
    continue
  fi

  ALL_OK=true
  for FN in "${FUNCTIONS[@]}"; do
    FN_PATH="supabase/functions/${FN}/index.ts"
    if [[ ! -f "${FN_PATH}" ]]; then
      echo "  [SKIP] ${FN}: not found at ${FN_PATH}"
      ALL_OK=false
      continue
    fi
    if ! supabase functions deploy "${FN}" --use-api >/dev/null 2>&1; then
      echo "  [FAIL] ${FN}"
      ALL_OK=false
    else
      echo "  [OK]   ${FN}"
    fi
  done

  if [[ "${ALL_OK}" == "true" ]]; then
    SUCCESS+=("${REF}")
  else
    FAILED+=("${REF}: deploy-failed")
  fi
done

# ---------------------------------------------------------------------------
# Restore original link
# ---------------------------------------------------------------------------
if [[ -n "${ORIGINAL_LINK}" ]]; then
  echo ""
  echo "Restoring original project link: ${ORIGINAL_LINK}"
  supabase link --project-ref "${ORIGINAL_LINK}" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "DEPLOYMENT SUMMARY"
echo "============================================================"
echo ""
if [[ ${#SUCCESS[@]} -gt 0 ]]; then
  echo "Successfully deployed to ${#SUCCESS[@]} project(s):"
  for REF in "${SUCCESS[@]}"; do
    echo "  [OK]   ${REF}"
  done
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  echo "Failed on ${#FAILED[@]} project(s):"
  for ENTRY in "${FAILED[@]}"; do
    echo "  [FAIL] ${ENTRY}"
  done
  exit 1
fi
echo ""
echo "All edge functions deployed to all accessible projects."
