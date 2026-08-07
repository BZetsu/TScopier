export type UniversalParseMode = 'off' | 'shadow' | 'fastpath' | 'primary'

const FASTPATH_CONFIDENCE = 0.99
const CEREBRAS_MODEL = 'gpt-oss-120b'
const RECONCILE_MODEL = 'gpt-4o'
const RECONCILE_TIMEOUT_MS = 8000

export function parseEnvBool(name: string, defaultValue = false): boolean {
  const raw = String(process.env[name] ?? (defaultValue ? 'true' : 'false')).trim()
  const v = raw.replace(/^["']|["']$/g, '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isUniversalParseEnabled(): boolean {
  if (parseEnvBool('UNIVERSAL_PARSE_ENABLED', true)) return true
  return getUniversalParseMode() !== 'off'
}

export function getUniversalParseMode(): UniversalParseMode {
  const raw = String(process.env.UNIVERSAL_PARSE_MODE ?? 'shadow').trim().toLowerCase()
  if (raw === 'fastpath' || raw === 'primary' || raw === 'shadow' || raw === 'off') {
    return raw
  }
  return 'shadow'
}

export function universalParseFastPathConfidence(): number {
  const n = Number(process.env.UNIVERSAL_PARSE_FASTPATH_CONFIDENCE ?? FASTPATH_CONFIDENCE)
  return Number.isFinite(n) ? Math.min(1, Math.max(0.5, n)) : FASTPATH_CONFIDENCE
}

/** AI may veto an otherwise parsed deterministic candidate only when enabled. */
export function universalParseAiVetoEnabled(): boolean {
  return parseEnvBool('UNIVERSAL_PARSE_AI_VETO_ENABLED', false)
}

export function universalParseModel(): string {
  return String(
    process.env.UNIVERSAL_PARSE_MODEL
    ?? process.env.AI_ENTRY_PARSE_MODEL
    ?? process.env.AI_MODIFICATION_PARSE_MODEL
    ?? 'gpt-4o-mini',
  ).trim() || 'gpt-4o-mini'
}

export function universalParseTimeoutMs(): number {
  return Math.max(500, Math.min(15_000, Number(process.env.UNIVERSAL_PARSE_TIMEOUT_MS ?? 4000)))
}

/** Stage 2 provider: fast OSS model on Cerebras Inference (OpenAI-compatible). */
export function cerebrasParseEnabled(): boolean {
  return parseEnvBool('CEREBRAS_PARSE_ENABLED', true)
}

export function cerebrasParseModel(): string {
  return String(process.env.CEREBRAS_PARSE_MODEL ?? CEREBRAS_MODEL).trim() || CEREBRAS_MODEL
}

/** Stage 3: GPT-4o reconciliation between deterministic and stage-2 results. */
export function universalParseReconcileEnabled(): boolean {
  return parseEnvBool('UNIVERSAL_PARSE_RECONCILE_ENABLED', false)
}

export function universalParseReconcileModel(): string {
  return String(
    process.env.UNIVERSAL_PARSE_RECONCILE_MODEL ?? RECONCILE_MODEL,
  ).trim() || RECONCILE_MODEL
}

export function universalParseReconcileTimeoutMs(): number {
  return Math.max(1000, Math.min(30_000, Number(process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS ?? RECONCILE_TIMEOUT_MS)))
}

export function universalParseStoreIntent(): boolean {
  return parseEnvBool('UNIVERSAL_PARSE_STORE_INTENT', true)
}
