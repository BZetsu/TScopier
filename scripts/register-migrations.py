#!/usr/bin/env python3
"""Register migrations in supabase_migrations.schema_migrations."""
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
        "curl", "-s", "-w", "%{http_code}", API,
        "-X", "POST",
        "-H", f"Authorization: Bearer {TOKEN}",
        "-H", "Content-Type: application/json",
        "--data-raw", payload,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    out = result.stdout.strip()
    code = out.split("\n")[-1] if "\n" in out else out
    return code in ("200", "201")

migrations = sorted(glob.glob("supabase/migrations/*.sql"))

for mf in migrations:
    basename = os.path.basename(mf)
    version = basename.split("_")[0]
    name = basename.replace(".sql", "")
    
    sql = (
        "INSERT INTO supabase_migrations.schema_migrations "
        "(version, statements, name) VALUES ("
        f"'{version}', "
        f"'[{{\"sql\": \"-- {name}\"}}]'::jsonb, "
        f"'{name}'"
        ") ON CONFLICT (version) DO NOTHING"
    )
    
    if run_sql(sql):
        print(f"  ✓ {version} {name}")
    else:
        print(f"  ✗ {version} {name}")

print("Done.")
