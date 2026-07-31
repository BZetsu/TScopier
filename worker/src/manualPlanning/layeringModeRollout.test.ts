import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  parseLayeringModesAccountAllowlist,
  resolveLayeringModeRolloutDecision,
} from './layeringModeRollout'

const account = '22222222-2222-4222-8222-222222222222'

test('rollout leaves legacy unaffected', () => {
  const decision = resolveLayeringModeRolloutDecision({ mode: 'legacy', env: {} })
  assert.equal(decision.executionAllowed, true)
  assert.equal(decision.reason, 'legacy')
})

test('rollout fails closed by default for static and dynamic', () => {
  assert.equal(resolveLayeringModeRolloutDecision({ mode: 'static', brokerAccountId: account, env: {} }).reason, 'global_disabled')
  assert.equal(resolveLayeringModeRolloutDecision({ mode: 'dynamic', brokerAccountId: account, env: {} }).executionAllowed, false)
})

test('kill switch blocks even when other flags are enabled', () => {
  const decision = resolveLayeringModeRolloutDecision({
    mode: 'static',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_STATIC_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_ACCOUNT_ALLOWLIST: account,
      LAYERING_MODES_KILL_SWITCH: 'true',
      LAYERING_MODES_PREPARE_ONLY: 'false',
    },
  })
  assert.equal(decision.reason, 'kill_switch_active')
  assert.equal(decision.activationAllowed, false)
})

test('mode flags and allowlist are required', () => {
  assert.equal(resolveLayeringModeRolloutDecision({
    mode: 'dynamic',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_KILL_SWITCH: 'false',
      LAYERING_MODES_ACCOUNT_ALLOWLIST: account,
    },
  }).reason, 'mode_disabled')
  assert.equal(resolveLayeringModeRolloutDecision({
    mode: 'static',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_STATIC_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_KILL_SWITCH: 'false',
    },
  }).reason, 'account_not_allowlisted')
})

test('prepare-only allows persistence but blocks activation/execution', () => {
  const decision = resolveLayeringModeRolloutDecision({
    mode: 'static',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_STATIC_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_KILL_SWITCH: 'false',
      LAYERING_MODES_ACCOUNT_ALLOWLIST: account,
      LAYERING_MODES_PREPARE_ONLY: 'true',
    },
  })
  assert.equal(decision.prepareAllowed, true)
  assert.equal(decision.activationAllowed, false)
  assert.equal(decision.executionAllowed, false)
  assert.equal(decision.reason, 'prepare_only')
})

test('all gates allow activation and execution', () => {
  const decision = resolveLayeringModeRolloutDecision({
    mode: 'dynamic',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_DYNAMIC_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_KILL_SWITCH: 'false',
      LAYERING_MODES_ACCOUNT_ALLOWLIST: account,
      LAYERING_MODES_PREPARE_ONLY: 'false',
    },
  })
  assert.equal(decision.reason, 'allowed')
  assert.equal(decision.executionAllowed, true)
})

test('invalid env and allowlist values fail closed', () => {
  assert.equal(resolveLayeringModeRolloutDecision({
    mode: 'static',
    brokerAccountId: account,
    env: {
      LAYERING_MODES_EXECUTION_ENABLED: 'true',
      LAYERING_STATIC_EXECUTION_ENABLED: 'true',
      LAYERING_MODES_KILL_SWITCH: 'maybe',
      LAYERING_MODES_ACCOUNT_ALLOWLIST: `${account}, * ,bad/id`,
      LAYERING_MODES_PREPARE_ONLY: 'false',
    },
  }).reason, 'kill_switch_active')
  const allowlist = parseLayeringModesAccountAllowlist(`${account}, * , bad/id, other`)
  assert.equal(allowlist.has(account), true)
  assert.equal(allowlist.has('*'), false)
  assert.equal(allowlist.has('bad/id'), false)
  assert.equal(allowlist.has('other'), true)
})
