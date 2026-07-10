import { hasExecutableTradeStructure } from './signalCommentaryGuard'
import {
  BUY_NOW_COMPOUND_RE,
  SELL_NOW_COMPOUND_RE,
  foldAccents,
  messageContainsKeyword,
  messageHasDirectionWithImmediateCue,
} from './multilingualSignalTerms'
import {
  messageHasExplicitSlTpLabels,
} from './signalEntryNowRequirement'

export type ImperativeEntryKeywordFields = {
  signal?: { buy?: string; sell?: string }
  additional?: { delimiters?: string }
}

function splitKeywordAliases(raw: string, delim: string): string[] {
  return String(raw ?? '').split(delim).map(s => s.trim()).filter(Boolean)
}

/** True when the message uses imperative entry wording (not prose selling/buying). */
export function messageHasImperativeEntryPhrase(
  message: string,
  channelKeywords?: ImperativeEntryKeywordFields | null,
): boolean {
  const raw = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return false

  if (hasExecutableTradeStructure(raw)) return true

  const folded = foldAccents(raw)
  if (BUY_NOW_COMPOUND_RE.test(folded)) return true
  if (SELL_NOW_COMPOUND_RE.test(folded)) return true
  if (messageHasDirectionWithImmediateCue(raw)) return true

  if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+now\b/i.test(raw)) return true
  if (/\b(?:buy|sell)\s+(?:gold|xau(?:usd)?)\s+now\b/i.test(raw)) return true

  const delim = channelKeywords?.additional?.delimiters ?? '|'
  const buyAliases = splitKeywordAliases(channelKeywords?.signal?.buy ?? '', delim)
  const sellAliases = splitKeywordAliases(channelKeywords?.signal?.sell ?? '', delim)
  for (const alias of [...buyAliases, ...sellAliases]) {
    if (!alias || !messageContainsKeyword(raw, alias)) continue
    const words = alias.trim().split(/\s+/).filter(Boolean)
    if (words.length >= 2) return true
    if (messageHasExplicitSlTpLabels(raw)) return true
  }

  return false
}
