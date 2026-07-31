import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('supabase/functions/layering-mode-capabilities/index.ts', 'utf8')

test('capability endpoint is authenticated and exposes no rollout secrets', () => {
  assert.match(source, /supabase\.auth\.getUser\(token\)/)
  assert.match(source, /\.eq\("user_id", authData\.user\.id\)/)
  assert.match(source, /LAYERING_MODES_EXECUTION_ENABLED/)
  assert.match(source, /LAYERING_MODES_KILL_SWITCH/)
  assert.match(source, /LAYERING_MODES_ACCOUNT_ALLOWLIST/)
  assert.match(source, /reasons/)
  assert.doesNotMatch(source, /return Response\.json\([^)]*Deno\.env/s)
  assert.doesNotMatch(source, /allowlist:\s|accountAllowlist|SUPABASE_SERVICE_ROLE_KEY[^)]*Response\.json/s)
})

test('capability endpoint keeps defaults disabled and pending support adapter-scoped', () => {
  assert.match(source, /flag\("LAYERING_MODES_EXECUTION_ENABLED", false\)/)
  assert.match(source, /flag\("LAYERING_STATIC_EXECUTION_ENABLED", false\)/)
  assert.match(source, /flag\("LAYERING_DYNAMIC_EXECUTION_ENABLED", false\)/)
  assert.match(source, /flag\("LAYERING_MODES_PREPARE_ONLY", true\)/)
  assert.match(source, /flag\("LAYERING_MODES_KILL_SWITCH", true\)/)
  assert.match(source, /platform !== "mt4" && platform !== "mt5"/)
  assert.match(source, /executionAvailable = configurable && !prepareOnly/)
  assert.match(source, /auto: \{ configurable, executable: executionAvailable \}/)
  assert.match(source, /executable: executionAvailable && args\.pendingCapability\.supported/)
})
