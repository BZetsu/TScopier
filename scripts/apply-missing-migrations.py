#!/usr/bin/env python3
"""Apply missing migrations to staging branch axdcledcyhyvzrnfkwat.
NEVER run against production (sxkpcovbyaficvtkpsdo)."""

import json
import os
import sys
import urllib.request
import urllib.error
import glob

PROJECT_REF = "axdcledcyhyvzrnfkwat"
TOKEN_PATH = os.path.expanduser("~/.supabase/access-token")
MIGRATIONS_DIR = "supabase/migrations"

def main():
    with open(TOKEN_PATH) as f:
        token = f.read().strip()

    api_url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # 1. Get already-applied migrations
    print("Fetching applied migrations...")
    req = urllib.request.Request(
        api_url,
        data=json.dumps({"query": "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"}).encode(),
        headers=headers,
    )
    try:
        resp = urllib.request.urlopen(req)
        applied_data = json.loads(resp.read())
        applied_versions = {row["version"] for row in applied_data}
    except urllib.error.HTTPError as e:
        print(f"Failed to fetch applied migrations: {e}")
        print(e.read().decode())
        sys.exit(1)

    print(f"  → {len(applied_versions)} migrations already applied on branch")

    # 2. Read all local migration files sorted by version
    migration_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    total_local = len(migration_files)
    print(f"  → {total_local} local migration files")

    # 3. Find missing ones
    missing = []
    for mf in migration_files:
        basename = os.path.basename(mf)
        version = basename.split("_")[0]
        if version not in applied_versions:
            missing.append(mf)

    print(f"  → {len(missing)} missing migrations to apply\n")

    if not missing:
        print("Nothing to apply. Schema is up-to-date.")
        return

    # 4. Apply each missing migration
    for mf in missing:
        basename = os.path.basename(mf)
        version = basename.split("_")[0]
        name = basename.replace(".sql", "")

        with open(mf) as f:
            sql = f.read()

        print(f"Applying: {version} ({name})...", end=" ", flush=True)

        # Execute migration SQL
        payload = json.dumps({"query": sql}).encode()
        req = urllib.request.Request(api_url, data=payload, headers=headers)
        try:
            resp = urllib.request.urlopen(req)
            # Read response (even if empty)
            _ = resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"FAILED ({e.code})")
            print(body[:500])
            print(f"\nFile: {mf}")
            sys.exit(1)

        # Register in schema_migrations
        # Build a safe statements JSON array
        safe_name = name.replace("'", "''")
        register_sql = (
            f"INSERT INTO supabase_migrations.schema_migrations "
            f"(version, statements, name) "
            f"VALUES ('{version}', '[{{\"sql\": \"-- {safe_name}\"}}]', '{safe_name}') "
            f"ON CONFLICT (version) DO NOTHING"
        )
        reg_payload = json.dumps({"query": register_sql}).encode()
        req = urllib.request.Request(api_url, data=reg_payload, headers=headers)
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError:
            # Non-fatal: registration failed but migration may have applied
            print("✓ (schema registration skipped)")
            continue

        print("✓")

    # 5. Verify final state
    print("\nVerifying final migration state...")
    req = urllib.request.Request(
        api_url,
        data=json.dumps({"query": "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5"}).encode(),
        headers=headers,
    )
    try:
        resp = urllib.request.urlopen(req)
        latest = json.loads(resp.read())
        print("Latest 5 applied migrations:")
        for row in latest:
            print(f"  {row['version']} - {row['name']}")
    except urllib.error.HTTPError as e:
        print(f"Verify failed: {e}")

    print(f"\nAll {len(missing)} missing migrations applied successfully.")
    print("Branch: axdcledcyhyvzrnfkwat (staging)")


if __name__ == "__main__":
    if PROJECT_REF not in {"axdcledcyhyvzrnfkwat"}:
        print(f"ERROR: Safety check failed! PROJECT_REF is {PROJECT_REF}")
        sys.exit(1)
    main()
