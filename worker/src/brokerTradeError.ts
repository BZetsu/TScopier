/**
 * Turn raw FxSocket / HTTP trade failures into messages users (and logs) can act on.
 * Prefer stable prefixes like `Symbol not found: XAUUSD` so the dashboard i18n can match them.
 */

export function parseFxErrorEnvelope(body: unknown): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (typeof o.detail === 'string' && o.detail.trim()) {
      return {
        message: o.detail.trim(),
        code: o.error != null ? String(o.error) : undefined,
      }
    }
    if (Array.isArray(o.detail) && o.detail.length > 0) {
      return { message: o.detail.map(String).join('; ') }
    }
    const message = String(o.message ?? o.Message ?? o.error ?? '').trim()
    const code = o.error != null && o.error !== o.message
      ? String(o.error)
      : o.code != null
        ? String(o.code)
        : undefined
    if (message && message !== 'null' && message !== 'undefined') {
      return { message, code }
    }
  }
  if (typeof body === 'string' && body.trim()) return { message: body.trim() }
  return { message: '' }
}

function symbolFromRequest(requestBody: unknown, url?: string): string | undefined {
  if (requestBody && typeof requestBody === 'object') {
    const o = requestBody as Record<string, unknown>
    const raw = o.symbol ?? o.Symbol ?? o.trade_symbol
    if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase()
  }
  if (url) {
    try {
      const u = new URL(url)
      const q = u.searchParams.get('symbol') ?? u.searchParams.get('Symbol')
      if (q?.trim()) return q.trim().toUpperCase()
    } catch {
      const m = /[?&]symbol=([^&]+)/i.exec(url)
      if (m?.[1]) {
        try {
          return decodeURIComponent(m[1]).trim().toUpperCase()
        } catch {
          return m[1].trim().toUpperCase()
        }
      }
    }
  }
  return undefined
}

function isSymbolSelectFailure(message: string, code?: string): boolean {
  const m = message.toLowerCase()
  const c = String(code ?? '').toLowerCase()
  return /symbolselect\s*failed/i.test(m)
    || /symbol\s+(?:not\s+found|select\s+failed|unavailable|unknown|disabled)/i.test(m)
    || (c === 'mrpc' && /symbol/i.test(m))
}

/**
 * Format an FxSocket HTTP failure for operators + UI (never bare "HTTP 500" when body has detail).
 */
export function formatFxHttpFailureMessage(opts: {
  status: number
  body: unknown
  requestBody?: unknown
  url?: string
}): string {
  const envelope = parseFxErrorEnvelope(opts.body)
  const symbol = symbolFromRequest(opts.requestBody, opts.url)
  if (isSymbolSelectFailure(envelope.message, envelope.code)) {
    return symbol
      ? `Symbol not found: ${symbol}`
      : 'Symbol not found on this broker account'
  }
  if (envelope.message) {
    // Avoid showing opaque transport codes alone (e.g. "MRPC").
    if (/^mrpc$/i.test(envelope.message) && symbol) {
      return `Symbol not found: ${symbol}`
    }
    if (!/^HTTP\s*\d{3}$/i.test(envelope.message)) return envelope.message
  }
  if (opts.status >= 500) {
    return symbol
      ? `Broker rejected the order for ${symbol}. Check symbol mapping and try again.`
      : 'Broker rejected this order. Check symbol mapping and connection, then try again.'
  }
  return `HTTP ${opts.status}`
}

/** Normalize catch-path OrderSend errors (v1 + v2) before persisting skip_reason / logs. */
export function humanizeOrderSendError(message: string, symbol?: string | null): string {
  const m = String(message ?? '').trim()
  if (!m) return 'Broker rejected this order'
  const sym = typeof symbol === 'string' && symbol.trim() ? symbol.trim().toUpperCase() : undefined
  if (isSymbolSelectFailure(m) || /^symbol\s+not\s+found(\s+on\s+this\s+broker\s+account)?$/i.test(m)) {
    return sym ? `Symbol not found: ${sym}` : (m.startsWith('Symbol not found') ? m : 'Symbol not found on this broker account')
  }
  const already = m.match(/^symbol not found:\s*([A-Z0-9._#+]+)/i)
  if (already) return `Symbol not found: ${already[1]!.toUpperCase()}`
  if (/^HTTP\s*5\d\d$/i.test(m)) {
    return sym
      ? `Broker rejected the order for ${sym}. Check symbol mapping and try again.`
      : 'Broker rejected this order. Check symbol mapping and connection, then try again.'
  }
  return m
}
