/**
 * Shared detection for channel management updates (breakeven, partial close, etc.).
 */

export function looksLikeChannelManagementUpdate(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return false
  return (
    /\b(move\s+stop|move\s+sl|stop\s+to\s+breakeven|breakeven|break\s*even)\b/i.test(t)
    || /\b(close\s+partial|closing\s+partial|take\s+partial|partial\s+(?:lot|lots|lotsize|position|trade))\b/i.test(t)
    || /\bsecure\s+\d+\s*%\s*profit/i.test(t)
    || /\btake\s+profit\s+(?:target\s+)?(?:is\s+)?hit\b/i.test(t)
    || /\bclose\s+(?:half|50%|25%|partials?)\b/i.test(t)
    || /\b\d{1,3}\s*%\s*(?:of\s+)?(?:the\s+)?(?:position|trade|lot|profit(?:s)?)\b/i.test(t)
  )
}

export function partialCloseFractionFromMessage(text: string): number | null {
  const m = String(text ?? '').match(
    /\b(?:secure|close|take)\s+(\d{1,2}|100)\s*%\s*(?:of\s+)?(?:the\s+)?(?:position|trade|lot|profit(?:s)?)?/i,
  )
  if (m?.[1]) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n <= 100) return n / 100
  }
  const pctOnly = String(text ?? '').match(
    /\b(\d{1,2}|100)\s*%\s*(?:of\s+)?(?:the\s+)?(?:position|trade|lot|profit(?:s)?)\b/i,
  )
  if (pctOnly?.[1]) {
    const n = Number(pctOnly[1])
    if (Number.isFinite(n) && n > 0 && n <= 100) return n / 100
  }
  return null
}

export function isPipCountInMessage(message: string, price: number): boolean {
  const s = String(price)
  return new RegExp(`(?:\\+|\\b)${s}\\s*pips?\\b`, 'i').test(String(message ?? ''))
}

export function bareTradePricesExcludingPips(message: string, prices: number[]): number[] {
  return prices.filter(p => !isPipCountInMessage(message, p))
}
