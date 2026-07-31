import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('supabase/functions/update-layering-settings/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260731120000_layering_plans.sql', 'utf8')

test('authoritative layering settings endpoint authenticates and owns account', () => {
  assert.match(source, /supabase\.auth\.getUser\(token\)/)
  assert.match(source, /\.eq\("id", brokerAccountId\)/)
  assert.match(source, /\.eq\("user_id", authData\.user\.id\)/)
  assert.match(source, /loadUserSubscription/)
  assert.match(source, /loadUserIsAdmin/)
})

test('authoritative layering settings endpoint validates enums, limits, rollout, and adapter', () => {
  assert.match(source, /normalizeMode\(body\.layering_mode\)/)
  assert.match(source, /normalizeMechanism\(body\.range_layering_type\)/)
  assert.match(source, /integerInRange\(body\.static_layer_count, 1, 20\)/)
  assert.match(source, /positiveFinite\(body\.dynamic_step_pips\)/)
  assert.match(source, /integerInRange\(body\.dynamic_max_layers, 1, 20\)/)
  assert.match(source, /configurationAllowed/)
  assert.match(source, /LAYERING_MODES_ACCOUNT_ALLOWLIST/)
  assert.doesNotMatch(source, /return args\.advancedAllowed && globalEnabled && !killSwitch && modeEnabled && listed/)
  assert.match(source, /mechanism === "pending_order" && !pendingCapability\.supported/)
  assert.match(source, /platform !== "mt4" && platform !== "mt5"/)
})

test('authoritative layering settings endpoint only updates future manual settings', () => {
  assert.match(source, /\.from\("broker_channel_trading_configs"\)/)
  assert.match(source, /\.from\("broker_accounts"\)/)
  assert.match(source, /mergeChannelConfigMap/)
  assert.match(source, /channel_trading_configs: channelConfigs/)
  assert.doesNotMatch(source, /layering_plans/)
  assert.doesNotMatch(source, /activate_layering_plan/)
  assert.doesNotMatch(source, /range_pending_legs/)
})

test('migration prevents direct authenticated layering settings bypass', () => {
  assert.match(migration, /prevent_client_layering_settings_bypass/)
  assert.match(migration, /current_user in \('anon', 'authenticated'\)/)
  assert.match(migration, /before insert or update on public\.broker_accounts/)
  assert.match(migration, /before insert or update on public\.broker_channel_trading_configs/)
  assert.match(migration, /layering_channel_configs_guard_fragment/)
  assert.match(migration, /channel_trading_configs/)
  assert.match(migration, /layering_mode/)
  assert.match(migration, /range_layering_type/)
})
