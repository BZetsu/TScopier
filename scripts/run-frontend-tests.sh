#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

vitest_files=()
while IFS= read -r file; do
  vitest_files+=("$file")
done < <(grep -rl "from 'vitest'" src --include='*.test.ts' || true)

node_files=()
while IFS= read -r file; do
  node_files+=("$file")
done < <(grep -rl "from 'node:test'" src --include='*.test.ts' || true)

status=0

if ((${#vitest_files[@]} > 0)); then
  npx vitest run "${vitest_files[@]}" || status=1
fi

if ((${#node_files[@]} > 0)); then
  node --import tsx --import ./test/preload.ts --test "${node_files[@]}" || status=1
fi

exit "$status"
