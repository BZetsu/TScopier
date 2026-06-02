import { tradeableFromParsed } from './backtestSignal'
import { looksLikeChannelManagementUpdate } from './signalManagementIntent'

export const COMMENTARY_NOT_SIGNAL_REASON = 'commentary_not_trade_signal'
export const ENTRY_MISSING_STRUCTURE_REASON = 'entry_missing_sl_tp_structure'

export function evaluateParsedSignalExecutionEligibility(
  parsed: {
    action?: unknown
    raw_instruction?: unknown
    symbol?: unknown
    entry_price?: unknown
    entry_zone_low?: unknown
    entry_zone_high?: unknown
    sl?: unknown
    tp?: unknown
    lot_size?: unknown
  } | null | undefined,
  rawMessage?: string | null,
): { eligible: boolean; skipReason?: string } {
  if (!parsed) return { eligible: false, skipReason: 'parsed_data_missing' }
  const action = String(parsed.action ?? '').toLowerCase()
  if (action !== 'buy' && action !== 'sell') return { eligible: true }

  const raw = String(rawMessage ?? parsed.raw_instruction ?? '').trim()
  if (raw) {
    if (/\b\d+(?:\.\d+)?\s*pips?\s+short\s+of\s+tp\d*\b/i.test(raw)) {
      return { eligible: false, skipReason: COMMENTARY_NOT_SIGNAL_REASON }
    }
    if (looksLikeChannelManagementUpdate(raw) && !/\b(buy|sell|long|short)\b/i.test(raw)) {
      return { eligible: false, skipReason: COMMENTARY_NOT_SIGNAL_REASON }
    }
  }

  if (!tradeableFromParsed(parsed)) {
    return { eligible: false, skipReason: ENTRY_MISSING_STRUCTURE_REASON }
  }
  return { eligible: true }
}
