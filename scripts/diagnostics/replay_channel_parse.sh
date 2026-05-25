#!/usr/bin/env bash
# Wrapper for worker/src/diagnostics/replayChannelParse.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/worker"
exec npx ts-node -r dotenv/config src/diagnostics/replayChannelParse.ts "$@"
