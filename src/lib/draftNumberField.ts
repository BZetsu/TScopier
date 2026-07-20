export type DraftNumberRules = {
  min?: number
  max?: number
  /** Empty string is invalid unless false. Default true. */
  required?: boolean
  /** Must be strictly greater than 0. */
  positive?: boolean
  integer?: boolean
}

export type DraftNumberMessages = {
  required: string
  invalid: string
  min: string
  max: string
  positive: string
}

export function parseDraftNumber(raw: string, rules: DraftNumberRules = {}): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  if (rules.integer && !Number.isInteger(n)) return null
  if (rules.positive && n <= 0) return null
  if (rules.min != null && n < rules.min) return null
  if (rules.max != null && n > rules.max) return null
  return n
}

export function draftNumberError(
  raw: string,
  rules: DraftNumberRules,
  messages: DraftNumberMessages,
  format: (template: string, vars: Record<string, string>) => string,
): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return rules.required === false ? null : messages.required
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return messages.invalid
  if (rules.integer && !Number.isInteger(n)) return messages.invalid
  if (rules.positive && n <= 0) return messages.positive
  if (rules.min != null && n < rules.min) {
    return format(messages.min, { min: String(rules.min) })
  }
  if (rules.max != null && n > rules.max) {
    return format(messages.max, { max: String(rules.max) })
  }
  return null
}
