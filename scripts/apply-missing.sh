#!/bin/bash
set -euo pipefail

PROJECT="axdcledcyhyvzrnfkwat"
TOKEN=$(cat ~/.supabase/access-token)
API="https://api.supabase.com/v1/projects/${PROJECT}/database/query"
DIR="supabase/migrations"

# Get applied
APPLIED=$(curl -s "${API}" \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw '{"query":"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"}' 2>&1 | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(r['version'])
")

# Get all local migration versions
ALL_VERSIONS=""
for f in "$DIR"/*.sql; do
    v=$(basename "$f" | cut -d_ -f1)
    ALL_VERSIONS="$ALL_VERSIONS $v"
done

# Find missing
MISSING=""
APPLIED_SET=" $APPLIED "
for v in $ALL_VERSIONS; do
    if [[ "$APPLIED_SET" != *" $v "* ]]; then
        MISSING="$MISSING $v"
    fi
done

read -ra MISSING_ARRAY <<< "$MISSING"
echo "Found ${#MISSING_ARRAY[@]} missing migrations"
[ ${#MISSING_ARRAY[@]} -eq 0 ] && { echo "Nothing to apply."; exit 0; }

# Apply each
for v in "${MISSING_ARRAY[@]}"; do
    f=$(ls "$DIR/${v}"*.sql | head -1)
    name=$(basename "$f" .sql)
    
    echo -n "Applying: $name... "
    
    # Build JSON payload properly
    payload=$(python3 -c "
import json
with open('$f') as fh:
    sql = fh.read()
print(json.dumps({'query': sql}))
")
    
    resp=$(curl -s -w "\n%{http_code}" "$API" \
        -X POST \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        --data-raw "$payload")
    
    code=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | sed '$d')
    
    if [ "$code" != "200" ]; then
        echo "FAILED ($code)"
        echo "$body" | head -5
        exit 1
    fi
    
    # Register in schema_migrations
    safe_name=$(echo "$name" | sed "s/'/''/g")
    reg=$(python3 -c "
import json
sql = \"INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('${v}', '[{\\\\"sql\\\\": \\\\"-- ${safe_name}\\\\\\"}]', '${safe_name}') ON CONFLICT (version) DO NOTHING\"
print(json.dumps({'query': sql}))
")
    
    curl -s "$API" \
        -X POST \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        --data-raw "$reg" > /dev/null
    
    echo "✓"
done

echo ""
echo "All ${#MISSING_ARRAY[@]} migrations applied successfully."
