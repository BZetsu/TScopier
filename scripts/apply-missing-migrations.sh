#!/bin/bash
# Apply missing migrations to staging branch axdcledcyhyvzrnfkwat
# NEVER run against production (sxkpcovbyaficvtkpsdo)

set -euo pipefail

PROJECT_REF="axdcledcyhyvzrnfkwat"
TOKEN="$(cat ~/.supabase/access-token)"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

MIGRATIONS_DIR="supabase/migrations"

# Get already-applied migrations from the branch
echo "Fetching applied migrations..."
APPLIED=$(curl -s "${API}" \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw '{"query":"select version from supabase_migrations.schema_migrations order by version"}' | python3 -c "
import json,sys
data=json.load(sys.stdin)
for row in data:
    print(row['version'])
")

# Build list of missing migrations
MISSING=()
for f in $(ls "${MIGRATIONS_DIR}"/*.sql | sort); do
  version=$(basename "$f" .sql | cut -d_ -f1)
  found=false
  while IFS= read -r applied; do
    if [ "$applied" = "$version" ]; then
      found=true
      break
    fi
  done <<< "$APPLIED"
  if [ "$found" = false ]; then
    MISSING+=("$f")
  fi
done

echo "Found ${#MISSING[@]} missing migrations to apply"

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "Nothing to apply."
  exit 0
fi

# Apply each migration in order
for mf in "${MISSING[@]}"; do
  version=$(basename "$mf" .sql | cut -d_ -f1)
  name=$(basename "$mf" .sql)
  
  # Read SQL content
  sql=$(cat "$mf")
  
  # Escape for JSON
  # Use jq-style approach - write to temp file
  payload=$(python3 -c "
import json, sys
with open('$mf', 'r') as f:
    sql = f.read()
print(json.dumps({'query': sql}))
")
  
  echo "Applying: $version ($name)..."
  resp=$(curl -s -w "\n%{http_code}" "${API}" \
    -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$payload")
  
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  
  if [ "$http_code" != "200" ]; then
    echo "FAILED ($http_code): $name"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    exit 1
  fi
  
  # Register in schema_migrations
  reg_payload=$(python3 -c "
import json
register = {'query': \"INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('${version}', '{ \\\"-- migration applied via API\\\" }', '${name}') ON CONFLICT (version) DO NOTHING\"}
print(json.dumps(register))
")
  
  curl -s "${API}" \
    -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$reg_payload" > /dev/null
  
  echo "  ✓ $version"
done

echo ""
echo "All ${#MISSING[@]} migrations applied successfully."
