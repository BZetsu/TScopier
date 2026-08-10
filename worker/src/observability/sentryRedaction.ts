const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 25
const MAX_OBJECT_KEYS = 60
const MAX_STRING_LENGTH = 1200

const SENSITIVE_KEY_RE =
  /(?:password|passwd|pwd|secret|token|bearer|cookie|set-cookie|authorization|api[_-]?key|auth[_-]?key|api[_-]?hash|service[_-]?role|session[_-]?string|phone[_-]?code[_-]?hash|phone|email|bvn|nin|identity[_-]?number|account[_-]?number|bank[_-]?account|client[_-]?secret|private[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|worker[_-]?internal[_-]?token|redis[_-]?token|openai[_-]?key|fxsocket|mt4|mt5|broker[_-]?(?:password|login|credential|secret|token)|balance|equity|free[_-]?margin|margin[_-]?free|request[_-]?body|response[_-]?body|raw[_-]?message|telegram[_-]?text|message[_-]?text|raw[_-]?telegram|signal[_-]?payload|broker[_-]?payload|layering[_-]?plan[_-]?snapshot)/i

const SENSITIVE_QUERY_KEYS =
  /(?:token|key|secret|password|auth|authorization|cookie|session|code|hash|email|phone)/i

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi
const API_KEY_RE = /\b(?:fxs|sk|rk|pk|sb|supabase|openai)[A-Za-z0-9_-]{16,}\b/gi
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_CANDIDATE_RE = /(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)/g

function redactPhones(input: string): string {
  return input.replace(PHONE_CANDIDATE_RE, (match) => {
    const digitCount = match.replace(/\D/g, '').length
    if (digitCount < 9 || digitCount > 15) return match
    return '[REDACTED_PHONE]'
  })
}

type SafeOpts = {
  depth?: number
  seen?: WeakSet<object>
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED ${value.length - MAX_STRING_LENGTH} chars]`
}

function stripUrlSecrets(input: string): string {
  try {
    const url = new URL(input)
    if (url.username) url.username = '[REDACTED]'
    if (url.password) url.password = '[REDACTED]'
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    return url.toString()
  } catch {
    return input.replace(/([?&][^=]*(?:token|key|secret|password|auth|phone|email)[^=]*=)[^&\s]+/gi, '$1[REDACTED]')
  }
}

export function redactStringForSentry(value: string): string {
  const strippedUrl = /\w+:\/\//.test(value) ? stripUrlSecrets(value) : value
  return truncate(strippedUrl
    .replace(PRIVATE_KEY_RE, '[REDACTED_PRIVATE_KEY]')
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(API_KEY_RE, '[REDACTED_KEY]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_CANDIDATE_RE, redactPhones))
}

function looksSerializedJson(value: string): boolean {
  const trimmed = value.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function safeError(err: Error, opts: SafeOpts): Record<string, unknown> {
  const seen = opts.seen ?? new WeakSet<object>()
  if (seen.has(err)) return { name: 'Error', message: '[Circular]' }
  seen.add(err)
  const out: Record<string, unknown> = {
    name: redactStringForSentry(err.name || 'Error'),
    message: redactStringForSentry(err.message || ''),
  }
  if (err.stack) out.stack = redactStringForSentry(err.stack)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause !== undefined) out.cause = safeForSentry(cause, { ...opts, seen, depth: (opts.depth ?? 0) + 1 })
  const aggregateErrorCtor = (globalThis as typeof globalThis & { AggregateError?: new (...args: unknown[]) => Error }).AggregateError
  if (aggregateErrorCtor && err instanceof aggregateErrorCtor) {
    out.errors = safeForSentry((err as Error & { errors?: unknown }).errors, { ...opts, seen, depth: (opts.depth ?? 0) + 1 })
  }
  for (const [key, value] of safeEntries(err as unknown as Record<string, unknown>)) {
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue
    out[key] = SENSITIVE_KEY_RE.test(key)
      ? '[REDACTED]'
      : safeForSentry(value, { ...opts, seen, depth: (opts.depth ?? 0) + 1 })
  }
  return out
}

function safeEntries(input: object): Array<[string, unknown]> {
  try {
    return Object.keys(input).map(key => {
      try {
        return [key, (input as Record<string, unknown>)[key]] as [string, unknown]
      } catch {
        return [key, '[UNREADABLE]'] as [string, unknown]
      }
    })
  } catch {
    return [['value', '[UNREADABLE]']]
  }
}

export function safeForSentry(input: unknown, opts: SafeOpts = {}): unknown {
  const depth = opts.depth ?? 0
  if (input == null) return input
  if (typeof input === 'string') {
    if (looksSerializedJson(input) && depth < MAX_DEPTH) {
      try {
        return safeForSentry(JSON.parse(input), { ...opts, depth: depth + 1 })
      } catch {
        return redactStringForSentry(input)
      }
    }
    return redactStringForSentry(input)
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input
  if (typeof input === 'bigint') return input.toString()
  if (typeof input === 'symbol' || typeof input === 'function') return `[${typeof input}]`
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]'
  if (input instanceof Error) return safeError(input, { ...opts, seen: opts.seen ?? new WeakSet<object>() })
  if (input instanceof URL) return redactStringForSentry(input.toString())
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.toISOString() : '[Invalid Date]'

  const seen = opts.seen ?? new WeakSet<object>()
  const obj = input as object
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)

  if (Array.isArray(input)) {
    const items = input.slice(0, MAX_ARRAY_ITEMS).map(item =>
      safeForSentry(item, { seen, depth: depth + 1 }),
    )
    if (input.length > MAX_ARRAY_ITEMS) items.push(`[TRUNCATED ${input.length - MAX_ARRAY_ITEMS} items]`)
    return items
  }

  if (input instanceof Map) {
    const items = Array.from(input.entries()).slice(0, MAX_ARRAY_ITEMS).map(([key, value]) => [
      safeForSentry(key, { seen, depth: depth + 1 }),
      safeForSentry(value, { seen, depth: depth + 1 }),
    ])
    if (input.size > MAX_ARRAY_ITEMS) items.push(['__truncated_items', input.size - MAX_ARRAY_ITEMS])
    return { type: 'Map', entries: items }
  }

  if (input instanceof Set) {
    const items = Array.from(input.values()).slice(0, MAX_ARRAY_ITEMS).map(item =>
      safeForSentry(item, { seen, depth: depth + 1 }),
    )
    if (input.size > MAX_ARRAY_ITEMS) items.push(`[TRUNCATED ${input.size - MAX_ARRAY_ITEMS} items]`)
    return { type: 'Set', values: items }
  }

  if (ArrayBuffer.isView(input)) {
    return `[${input.constructor.name} ${input.byteLength} bytes]`
  }

  const out: Record<string, unknown> = {}
  const entries = safeEntries(input).slice(0, MAX_OBJECT_KEYS)
  for (const [key, value] of entries) {
    const safeKey = redactStringForSentry(key)
    out[safeKey] = SENSITIVE_KEY_RE.test(key)
      ? '[REDACTED]'
      : safeForSentry(value, { seen, depth: depth + 1 })
  }
  let totalKeys = entries.length
  try {
    totalKeys = Object.keys(input as Record<string, unknown>).length
  } catch {
    out.__unreadable_keys = true
  }
  if (totalKeys > MAX_OBJECT_KEYS) out.__truncated_keys = totalKeys - MAX_OBJECT_KEYS
  return out
}

export function normalizedErrorCode(err: unknown, fallback = 'UNKNOWN'): string {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const safe = redactStringForSentry(message).toUpperCase()
  const explicit = safe.match(/\b[A-Z][A-Z0-9_]{2,}\b/)
  return explicit?.[0] ?? fallback
}
