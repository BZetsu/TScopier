#!/usr/bin/env python3
"""Apply missing migrations to staging branch via curl subprocess.
Uses curl for HTTP (urllib has 403 issues with Supabase API), 
python for JSON encoding safely."""

import json
import os
import subprocess
import sys
import glob

PROJECT_REF = "axdcledcyhyvzrnfkwat"
TOKEN_PATH = os.path.expanduser("~/.supabase/access-token")
MIGRATIONS_DIR = "supabase/migrations"

def curl_post(url, payload_dict, token):
    """Execute curl POST, return (success: bool, body: str)"""
    payload = json.dumps(payload_dict)
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}",
        url,
        "-X", "POST",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Content-Type: application/json",
        "--data-raw", payload,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    output = result.stdout.strip()
    if not output:
        return False, f"Empty response (stderr: {result.stderr})"
    
    lines = output.rsplit("\n", 1)
    http_code = lines[-1].strip()
    body = lines[0] if len(lines) > 1 else ""
    
    if http_code in {"200", "201"}:
        return True, body
    else:
        return False, f"HTTP {http_code}: {body[:500]}"

def main():
    with open(TOKEN_PATH) as f:
        token = f.read().strip()

    api_url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    
    # Safety check
    assert PROJECT_REF == "axdcledcyhyvzrnfkwat", "Safety check failed!"
    print(f"Target: {PROJECT_REF} (staging branch)")
    print()

    # 1. Get applied migrations
    print("Fetching applied migrations...")
    ok, body = curl_post(api_url, {"query": "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"}, token)
    if not ok:
        print(f"FAILED: {body}")
        sys.exit(1)
    
    applied_data = json.loads(body)
    applied_versions = {row["version"] for row in applied_data}
    print(f"  → {len(applied_versions)} migrations applied on branch")

    # 2. All local migrations
    migration_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    print(f"  → {len(migration_files)} local migration files")

    # 3. Filter missing
    missing = []
    for mf in migration_files:
        version = os.path.basename(mf).split("_")[0]
        if version not in applied_versions:
            missing.append(mf)
    
    print(f"  → {len(missing)} need to be applied")
    print()

    if not missing:
        print("Nothing to apply. Schema is up-to-date.")
        return

    # 4. Apply each
    for mf in missing:
        basename = os.path.basename(mf)
        version = basename.split("_")[0]
        name = basename.replace(".sql", "")

        with open(mf) as f:
            sql = f.read()

        print(f"Applying: {version} ({name})...", end=" ", flush=True)

        ok, body = curl_post(api_url, {"query": sql}, token)
        if not ok:
            print(f"FAILED")
            print(body)
            sys.exit(1)

        # Register in schema_migrations
        safe_name = name.replace("'", "''")
        register_sql = (
            f"INSERT INTO supabase_migrations.schema_migrations "
            f"(version, statements, name) "
            f"VALUES ('{version}', '[{{\"sql\": \"-- {safe_name}\"}}]', '{safe_name}') "
            f"ON CONFLICT (version) DO NOTHING"
        )
        ok2, _ = curl_post(api_url, {"query": register_sql}, token)
        if not ok2:
            print("✓ (register skipped)")
        else:
            print("✓")

    # 5. Verify
    print("\nVerifying final state...")
    ok, body = curl_post(api_url, {
        "query": "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5"
    }, token)
    if ok:
        latest = json.loads(body)
        print("Latest 5 migrations:")
        for row in latest:
            print(f"  {row['version']} - {row['name']}")

    print(f"\nAll {len(missing)} missing migrations applied to branch {PROJECT_REF}")

if __name__ == "__main__":
    main()
