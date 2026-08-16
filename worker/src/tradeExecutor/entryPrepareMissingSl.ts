import {
  resolvedParsedEntryPrice,
  resolvedParsedEntryZone,
  type ManualSettings,
  type ParsedSignal,
} from '../manualPlanner'
import {
  ENTRY_TP_WITHOUT_SL_REASON,
  entryHasTpWithoutSl,
  parsedHasSlOrTp,
} from '../signalEntryNowRequirement'
import {
  SIGNAL_MISSING_REQUIRED_SL,
  isStopLossWithheldByProvider,
} from '../brokerTradeError'

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsedEntryAnchorForFallback(parsed: ParsedSignal): number | null {
  const entry = resolvedParsedEntryPrice(parsed)
  if (entry != null) return entry
  const zone = resolvedParsedEntryZone(parsed)
  return zone != null ? (zone.lo + zone.hi) / 2 : null
}

export function configuredFallbackSlPossible(parsed: ParsedSignal, manual: ManualSettings): boolean {
  const anchor = parsedEntryAnchorForFallback(parsed)
  if (manual.use_predefined_sl_pips === true && positiveNumber(manual.predefined_sl_pips) != null && anchor != null) {
    return true
  }
  const firstTp = (parsed.tp ?? []).map(positiveNumber).find((n): n is number => n != null)
  return manual.rr_for_sl_enabled === true
    && positiveNumber(manual.rr_for_sl) != null
    && firstTp != null
    && anchor != null
}

/**
 * Returns a skip when the entry must not open due to a missing stop loss.
 * - TP without usable SL → `entry_tp_without_sl` (unless predefined/RR fallback applies)
 * - `add_new_trades_to_existing === false` with no explicit stops → `SIGNAL_MISSING_REQUIRED_SL`
 */
export function missingRequiredSlFailure(parsed: ParsedSignal, manual: ManualSettings): {
  withheldByProvider: boolean
  reason: string
} | null {
  if (positiveNumber(parsed.sl) != null) return null

  const withheldByProvider = isStopLossWithheldByProvider(parsed.raw_instruction)

  // Take-profit without a usable stop loss: never open unless account can derive SL.
  if (entryHasTpWithoutSl(parsed)) {
    if (configuredFallbackSlPossible(parsed, manual)) return null
    return { withheldByProvider, reason: ENTRY_TP_WITHOUT_SL_REASON }
  }

  if (manual.add_new_trades_to_existing === false && !parsedHasSlOrTp(parsed)) {
    if (withheldByProvider && configuredFallbackSlPossible(parsed, manual)) return null
    return { withheldByProvider, reason: SIGNAL_MISSING_REQUIRED_SL }
  }
  return null
}
