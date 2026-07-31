import type { LayeringMode } from './types'

export type LayeringModeRolloutReason =
  | 'legacy'
  | 'global_disabled'
  | 'kill_switch_active'
  | 'mode_disabled'
  | 'account_not_allowlisted'
  | 'prepare_only'
  | 'allowed'

export interface LayeringModeRolloutDecision {
  readonly allowed: boolean
  readonly prepareAllowed: boolean
  readonly activationAllowed: boolean
  readonly executionAllowed: boolean
  readonly reason: LayeringModeRolloutReason
}

export interface LayeringModeRolloutInput {
  readonly mode: LayeringMode
  readonly brokerAccountId?: string | null
  readonly env?: Record<string, string | undefined>
}

function parseStrictBoolean(value: string | undefined, fallback: boolean, opts?: { readonly invalidIs?: boolean }): boolean {
  if (value == null || value.trim() === '') return fallback
  const raw = value.trim().toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'yes') return true
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  return opts?.invalidIs ?? fallback
}

function safeAccountId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return null
  for (const char of trimmed) {
    const code = char.charCodeAt(0)
    if (code <= 32 || code === 127) return null
  }
  if (/[*?%/\\]/.test(trimmed)) return null
  return trimmed
}

export function parseLayeringModesAccountAllowlist(raw: string | undefined): ReadonlySet<string> {
  const out = new Set<string>()
  for (const part of String(raw ?? '').split(',')) {
    const accountId = safeAccountId(part)
    if (accountId) out.add(accountId)
  }
  return out
}

export function resolveLayeringModeRolloutDecision(input: LayeringModeRolloutInput): LayeringModeRolloutDecision {
  const env = input.env ?? process.env
  const mode = input.mode
  if (mode === 'legacy') {
    return {
      allowed: true,
      prepareAllowed: true,
      activationAllowed: true,
      executionAllowed: true,
      reason: 'legacy',
    }
  }

  const globalEnabled = parseStrictBoolean(env.LAYERING_MODES_EXECUTION_ENABLED, false)
  if (!globalEnabled) {
    return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'global_disabled' }
  }

  const killSwitchActive = parseStrictBoolean(env.LAYERING_MODES_KILL_SWITCH, true, { invalidIs: true })
  if (killSwitchActive) {
    return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'kill_switch_active' }
  }

  const modeFlagName = mode === 'static'
    ? 'LAYERING_STATIC_EXECUTION_ENABLED'
    : 'LAYERING_DYNAMIC_EXECUTION_ENABLED'
  if (!parseStrictBoolean(env[modeFlagName], false)) {
    return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'mode_disabled' }
  }

  const allowlist = parseLayeringModesAccountAllowlist(env.LAYERING_MODES_ACCOUNT_ALLOWLIST)
  const accountId = typeof input.brokerAccountId === 'string' ? input.brokerAccountId.trim() : ''
  if (!accountId || !allowlist.has(accountId)) {
    return { allowed: false, prepareAllowed: false, activationAllowed: false, executionAllowed: false, reason: 'account_not_allowlisted' }
  }

  const prepareOnly = parseStrictBoolean(env.LAYERING_MODES_PREPARE_ONLY, true, { invalidIs: true })
  if (prepareOnly) {
    return { allowed: true, prepareAllowed: true, activationAllowed: false, executionAllowed: false, reason: 'prepare_only' }
  }

  return {
    allowed: true,
    prepareAllowed: true,
    activationAllowed: true,
    executionAllowed: true,
    reason: 'allowed',
  }
}
