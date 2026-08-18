#!/usr/bin/env python3
"""Register all migrations in supabase_migrations.schema_migrations."""
import json
import os
import subprocess
import glob

PROJECT_REF = "axdcledcyhyvzrnfkwat"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
TOKEN = open(os.path.expanduser("~/.supabase/access-token")).read().strip()

def run_sql(sql):
    payload = json.dumps({"query": sql})
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}", API,
        "-X", "POST",
        "-H", f"Authorization: Bearer {TOKEN}",
        "-H", "Content-Type: application/json",
        "--data-raw", payload,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    out = result.stdout.strip()
    parts = out.rsplit("\n", 1)
    code = parts[-1].strip() if len(parts) > 1 else parts[0]
    return code, out

migrations = sorted(glob.glob("supabase/migrations/*.sql"))

success = 0
failed = 0

for mf in migrations:
    basename = os.path.basename(mf)
    version = basename.split("_")[0]
    name = basename.replace(".sql", "")

    # text[] format: use ARRAY[...] syntax or '{...}'::text[]
    sql = (
        f"INSERT INTO supabase_migrations.schema_migrations "
        f"(version, statements, name) VALUES ("
        f"'{version}', "
        f"ARRAY['-- {name}']::text[], "
        f"'{name}'"
        f") ON CONFLICT (version) DO NOTHING"
    )

    code, _ = run_sql(sql)
    if code in ("200", "201"):
        success += 1
    else:
        failed += 1
        print(f"  ✗ {version} {name} (HTTP {code})")

print(f"\nDone. Registered: {success} succeeded, {failed} failed")
