import type { ParseChannelMessageResult } from '../parseSignal'
import type { TradeIntent } from './tradeIntent'
import { tradeIntentToChannelParsedSignal } from './tradeIntentAdapter'

export type ParseShadowDiff = {
  differs: boolean
  deterministic_action: string
  universal_action: string
  deterministic_symbol: string | null
  universal_symbol: string | null
  deterministic_sl: number | null
  universal_sl: number | null
  deterministic_tp: number[]
  universal_tp: number[]
}

function actionOf(result: ParseChannelMessageResult): string {
  return String(result.parsed.action ?? '').toLowerCase()
}

function normTp(tp: unknown): number[] {
  if (!Array.isArray(tp)) return []
  return tp.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
}

export function compareParseShadowDiff(
  deterministic: ParseChannelMessageResult,
  universalParsed: ParseChannelMessageResult,
): ParseShadowDiff {
  const det = deterministic.parsed
  const uni = universalParsed.parsed
  const diff: ParseShadowDiff = {
    differs: false,
    deterministic_action: actionOf(deterministic),
    universal_action: actionOf(universalParsed),
    deterministic_symbol: det.symbol ?? null,
    universal_symbol: uni.symbol ?? null,
    deterministic_sl: typeof det.sl === 'number' ? det.sl : null,
    universal_sl: typeof uni.sl === 'number' ? uni.sl : null,
    deterministic_tp: normTp(det.tp),
    universal_tp: normTp(uni.tp),
  }
  diff.differs =
    diff.deterministic_action !== diff.universal_action
    || diff.deterministic_symbol !== diff.universal_symbol
    || diff.deterministic_sl !== diff.universal_sl
    || JSON.stringify(diff.deterministic_tp) !== JSON.stringify(diff.universal_tp)
  return diff
}

export function intentActionLabel(intent: TradeIntent): string {
  if (intent.kind === 'entry') {
    return intent.side === 'BUY' ? 'buy' : intent.side === 'SELL' ? 'sell' : 'ignore'
  }
  if (intent.kind === 'modify') return 'modify'
  if (intent.kind === 'close') return 'close'
  if (intent.kind === 'breakeven') return 'breakeven'
  if (intent.kind === 'partial_close') return 'partial_profit'
  return 'ignore'
}

export function intentToParsePreview(intent: TradeIntent, rawMessage: string): ParseChannelMessageResult {
  const parsed = tradeIntentToChannelParsedSignal(intent, rawMessage)
  const isIgnore = parsed.action === 'ignore'
  return {
    parsed,
    status: isIgnore ? 'skipped' : 'parsed',
    skip_reason: isIgnore ? 'universal_intent_ignore' : null,
  }
}
