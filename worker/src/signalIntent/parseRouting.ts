import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelKeywords, ChannelLexiconRow, ParseChannelMessageResult } from '../parseSignal'
import { getUniversalParseMode, universalParseAiVetoEnabled, universalParseReconcileEnabled } from './parseConfig'
import { compareParseShadowDiff } from './shadowDiff'
import { tradeIntentToChannelParsedSignal } from './tradeIntentAdapter'
import type { TradeIntent, TradeIntentKind } from './tradeIntent'
import {
  loadOpenTradesForChannel,
  loadParentSignalSymbol,
  modificationTargetsOpenTrade,
  resolveModificationParentSymbol,
  MODIFICATION_NO_OPEN_TRADE_REASON,
  MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON,
} from '../signalModificationGrounding'
import {
  deterministicQualifiesForFastPath,
  parseDeterministicForUniversal,
  parseUniversalSignal,
  reconcileUniversalSignal,
  type UniversalParseResult,
} from './universalSignalParser'

export type RoutedParseResult = {
  parseResult: ParseChannelMessageResult
  aiMeta?: {
    intent: string
    source: string
    fallbackReason?: string
    reviewRequired?: boolean
  }
  universalIntent?: UniversalParseResult['intent']
}

const EXECUTABLE_KINDS: ReadonlySet<TradeIntentKind> = new Set([
  'entry', 'modify', 'close', 'breakeven', 'partial_close', 'cancel_pending',
])

const MODIFICATION_KINDS: ReadonlySet<TradeIntentKind> = new Set([
  'modify', 'close', 'breakeven', 'partial_close',
])

function groundingSkipResult(
  rawMessage: string,
  reason: string,
  source: UniversalParseResult['source'],
): UniversalParseResult {
  const intent: TradeIntent = {
    kind: 'ignore',
    side: null,
    symbol: null,
    entry: [],
    sl: null,
    tp: [],
    sl_unit: 'price',
    tp_unit: 'price',
    flags: {},
    confidence: 0,
  }
  return {
    intent,
    source,
    skip_reason: reason,
    parseResult: {
      parsed: tradeIntentToChannelParsedSignal(intent, rawMessage),
      status: 'skipped',
      skip_reason: reason,
    },
  }
}

/**
 * Modification grounding: an SL/TP modification must target the user's OPEN
 * trade for this channel, and — when the message is a Telegram reply — must
 * match the parent signal's symbol (the channel told us which trade it means).
 *
 * Reply-based symbol enforcement:
 * - parent symbol known + model omitted the symbol → fill with the parent's.
 * - parent symbol known + model contradicts it → forced GPT-4o reconciliation;
 *   GPT-4o must match the parent or the modification is skipped.
 * - no parent → model symbol is judged against open trades only.
 *
 * Open-trade grounding:
 * - no open trades at all → stale modification, skip.
 * - open trades exist but the symbol misses → forced GPT-4o reconciliation
 *   with the open-trade list; GPT-4o's result must also hit an open trade.
 *
 * Query failure returns null → fail open, normal flow continues (the trade
 * worker merge only modifies open baskets anyway).
 */
async function groundModificationResult(args: {
  supabase: SupabaseClient
  userId: string
  channelRowId: string
  rawMessage: string
  isReply: boolean
  parentSignalId: string | null
  isModificationClass: boolean
  revision?: {
    prior_raw_message: string
    prior_parsed_data: Record<string, unknown> | null
  }
  det: ParseChannelMessageResult
  universal: UniversalParseResult
}): Promise<UniversalParseResult | null> {
  const { universal } = args
  if (universal.parseResult.status !== 'parsed' || !MODIFICATION_KINDS.has(universal.intent.kind)) {
    return null
  }

  const [openTrades, parentSymbol] = await Promise.all([
    loadOpenTradesForChannel(args.supabase, {
      userId: args.userId,
      channelRowId: args.channelRowId,
    }),
    loadParentSignalSymbol(args.supabase, args.parentSignalId),
  ])
  if (openTrades === null) return null

  // Reply-based enforcement: the parent's symbol is ground truth.
  let grounded = universal
  const parentResolution = resolveModificationParentSymbol({
    parentSymbol,
    modelSymbol: universal.intent.symbol ?? null,
  })
  if (parentResolution.kind === 'fill') {
    grounded = withIntentSymbol(universal, parentResolution.symbol)
  } else if (parentResolution.kind === 'conflict') {
    if (!universalParseReconcileEnabled()) {
      return groundingSkipResult(args.rawMessage, MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, universal.source)
    }
    const reconciled = await reconcileUniversalSignal(args.supabase, {
      userId: args.userId,
      channelRowId: args.channelRowId,
      rawMessage: args.rawMessage,
      isReply: args.isReply,
      parentSignalId: args.parentSignalId,
      revision: args.revision,
      isModificationClass: args.isModificationClass,
    }, {
      deterministic: args.det,
      stage2: universal,
      reason: `modification_parent_symbol_conflict:${parentResolution.modelSymbol}`,
      openTrades,
    })
    if (reconciled.source !== 'gpt4o') {
      return groundingSkipResult(args.rawMessage, MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, universal.source)
    }
    const reconciledResolution = resolveModificationParentSymbol({
      parentSymbol,
      modelSymbol: reconciled.intent.symbol ?? null,
    })
    if (
      reconciled.parseResult.status !== 'parsed'
      || !MODIFICATION_KINDS.has(reconciled.intent.kind)
      || reconciledResolution.kind !== 'ok'
    ) {
      return groundingSkipResult(args.rawMessage, MODIFICATION_PARENT_SYMBOL_CONFLICT_REASON, 'gpt4o')
    }
    grounded = reconciled
  }

  if (openTrades.length === 0) {
    return groundingSkipResult(args.rawMessage, MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source)
  }

  if (modificationTargetsOpenTrade(grounded.intent, openTrades)) return null

  if (!universalParseReconcileEnabled()) {
    return groundingSkipResult(args.rawMessage, MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source)
  }

  const reconciled = await reconcileUniversalSignal(args.supabase, {
    userId: args.userId,
    channelRowId: args.channelRowId,
    rawMessage: args.rawMessage,
    isReply: args.isReply,
    parentSignalId: args.parentSignalId,
    revision: args.revision,
    isModificationClass: args.isModificationClass,
  }, {
    deterministic: args.det,
    stage2: grounded,
    reason: `modification_target_not_open:${grounded.intent.symbol ?? 'null'}`,
    openTrades,
  })
  if (reconciled.source !== 'gpt4o') {
    return groundingSkipResult(args.rawMessage, MODIFICATION_NO_OPEN_TRADE_REASON, grounded.source)
  }
  if (
    reconciled.parseResult.status === 'parsed'
    && MODIFICATION_KINDS.has(reconciled.intent.kind)
    && !modificationTargetsOpenTrade(reconciled.intent, openTrades)
  ) {
    return groundingSkipResult(args.rawMessage, MODIFICATION_NO_OPEN_TRADE_REASON, 'gpt4o')
  }
  return reconciled
}

/** Copy a universal result with a forced symbol on both the intent and parsed signal. */
function withIntentSymbol(
  result: UniversalParseResult,
  symbol: string,
): UniversalParseResult {
  return {
    ...result,
    intent: { ...result.intent, symbol },
    parseResult: {
      ...result.parseResult,
      parsed: {
        ...result.parseResult.parsed,
        symbol,
      },
    },
  }
}

/**
 * Stage 3 trigger (Option 1): GPT-4o reconciliation runs only when stage 2
 * (OSS) is uncertain, when the hallucination guard rejected stage 2's prices,
 * or when stage 2 blocks a trade the deterministic parser found. OSS-confirmed
 * and OSS-recovered results are trusted without the final model.
 */
export function shouldReconcileSignal(
  det: ParseChannelMessageResult,
  universal: UniversalParseResult,
): boolean {
  if (universal.source === 'unavailable') return false
  if (universal.intent.kind === 'uncertain') return true
  if (
    universal.skip_reason?.startsWith('intent_validation_failed') === true
    || universal.skip_reason === 'entry_missing_side'
  ) {
    return true
  }
  const detParsed = det.status === 'parsed' && det.parsed.action !== 'ignore'
  const uniExecutable = EXECUTABLE_KINDS.has(universal.intent.kind)
  return detParsed && !uniExecutable
}

function routeStageThreeResult(
  reconciled: UniversalParseResult,
  det: ParseChannelMessageResult,
): RoutedParseResult {
  if (reconciled.parseResult.status === 'parsed') {
    return {
      parseResult: reconciled.parseResult,
      aiMeta: { intent: reconciled.intent.kind, source: reconciled.source },
      universalIntent: reconciled.intent,
    }
  }
  if (reconciled.intent.kind === 'uncertain') {
    return {
      parseResult: reconciled.parseResult,
      aiMeta: {
        intent: 'uncertain',
        source: reconciled.source,
        reviewRequired: true,
      },
      universalIntent: reconciled.intent,
    }
  }
  if (universalParseAiVetoEnabled()) {
    return {
      parseResult: reconciled.parseResult,
      aiMeta: { intent: reconciled.intent.kind, source: reconciled.source },
      universalIntent: reconciled.intent,
    }
  }
  return {
    parseResult: det.status === 'parsed' ? det : reconciled.parseResult,
    aiMeta: {
      intent: reconciled.intent.kind,
      source: reconciled.source,
      fallbackReason: 'ai_veto_disabled',
    },
    universalIntent: reconciled.intent,
  }
}

async function runStageThree(args: {
  supabase: SupabaseClient
  userId: string
  channelRowId: string
  signalId: string
  rawMessage: string
  isReply: boolean
  parentSignalId: string | null
  isModificationClass: boolean
  revision?: {
    prior_raw_message: string
    prior_parsed_data: Record<string, unknown> | null
  }
  det: ParseChannelMessageResult
  universal: UniversalParseResult
}): Promise<UniversalParseResult | null> {
  if (!universalParseReconcileEnabled()) return null
  if (!shouldReconcileSignal(args.det, args.universal)) return null
  const reconciled = await reconcileUniversalSignal(args.supabase, {
    userId: args.userId,
    channelRowId: args.channelRowId,
    rawMessage: args.rawMessage,
    isReply: args.isReply,
    parentSignalId: args.parentSignalId,
    revision: args.revision,
    isModificationClass: args.isModificationClass,
  }, {
    deterministic: args.det,
    stage2: args.universal,
    reason: args.universal.skip_reason ?? null,
  })
  return reconciled.source === 'gpt4o' ? reconciled : null
}

export async function routeSignalParse(args: {
  supabase: SupabaseClient
  userId: string
  channelRowId: string
  signalId: string
  rawMessage: string
  isReply: boolean
  parentSignalId: string | null
  isModificationClass: boolean
  keywords: ChannelKeywords
  lexicon: ChannelLexiconRow | null
  revision?: {
    prior_raw_message: string
    prior_parsed_data: Record<string, unknown> | null
  }
}): Promise<RoutedParseResult> {
  const mode = getUniversalParseMode()
  const det = parseDeterministicForUniversal(
    args.rawMessage,
    args.keywords,
    args.lexicon,
    args.isModificationClass,
  )

  const runUniversal = () => parseUniversalSignal(args.supabase, {
    userId: args.userId,
    channelRowId: args.channelRowId,
    rawMessage: args.rawMessage,
    isReply: args.isReply,
    parentSignalId: args.parentSignalId,
    revision: args.revision,
    isModificationClass: args.isModificationClass,
  })

  if (mode === 'off') {
    return { parseResult: det }
  }

  if (mode === 'shadow') {
    void runUniversal()
      .then(universal => logShadowDiff(args.supabase, {
        userId: args.userId,
        signalId: args.signalId,
        channelRowId: args.channelRowId,
        deterministic: det,
        universal,
      }))
      .catch(() => undefined)
    return { parseResult: det }
  }

  const fastPathOk = deterministicQualifiesForFastPath(det, args.rawMessage, args.keywords)

  if (mode === 'fastpath' && fastPathOk) {
    return { parseResult: det, aiMeta: { intent: String(det.parsed.action), source: 'deterministic' } }
  }

  if (mode === 'fastpath' && !fastPathOk) {
    const universal = await runUniversal()

    const aiUnavailable = universal.source === 'unavailable'
      || universal.skip_reason === 'universal_parse_unavailable'

    // Modification grounding: SL/TP changes must target an open trade in the
    // channel. Runs before the stage-3 triggers so a wrong-symbol modification
    // is either re-grounded by GPT-4o or skipped instead of dispatching to a
    // closed or unrelated trade.
    if (!aiUnavailable) {
      const grounded = await groundModificationResult({
        supabase: args.supabase,
        userId: args.userId,
        channelRowId: args.channelRowId,
        rawMessage: args.rawMessage,
        isReply: args.isReply,
        parentSignalId: args.parentSignalId,
        isModificationClass: args.isModificationClass,
        revision: args.revision,
        det,
        universal,
      })
      if (grounded) {
        if (grounded.source === 'gpt4o') return routeStageThreeResult(grounded, det)
        return {
          parseResult: grounded.parseResult,
          aiMeta: {
            intent: grounded.intent.kind,
            source: grounded.source,
            fallbackReason: grounded.skip_reason ?? undefined,
          },
          universalIntent: grounded.intent,
        }
      }
    }

    // Stage 3 (GPT-4o) reconciliation: runs before the stage-2 early return so
    // a stage-2 recovery of a deterministic skip or a validation failure is
    // adjudicated by the final model instead of dispatching or skipping blindly.
    if (!aiUnavailable) {
      const reconciled = await runStageThree({
        supabase: args.supabase,
        userId: args.userId,
        channelRowId: args.channelRowId,
        signalId: args.signalId,
        rawMessage: args.rawMessage,
        isReply: args.isReply,
        parentSignalId: args.parentSignalId,
        isModificationClass: args.isModificationClass,
        revision: args.revision,
        det,
        universal,
      })
      if (reconciled) {
        return routeStageThreeResult(reconciled, det)
      }
    }

    if (universal.parseResult.status === 'parsed') {
      return {
        parseResult: universal.parseResult,
        aiMeta: { intent: universal.intent.kind, source: universal.source },
        universalIntent: universal.intent,
      }
    }

    if (aiUnavailable) {
      return {
        parseResult: det,
        aiMeta: {
          intent: 'deterministic_fallback',
          source: 'deterministic',
          fallbackReason: universal.skip_reason ?? 'universal_parse_unavailable',
        },
        universalIntent: universal.intent,
      }
    }

    // Only an explicit uncertain result enters human review. Clear commentary
    // and ignore results are ordinary skips and must not create review spam.
    if (universalParseAiVetoEnabled()) {
      return {
        parseResult: universal.parseResult,
        aiMeta: {
          intent: universal.intent.kind,
          source: universal.source,
          reviewRequired: universal.intent.kind === 'uncertain',
        },
        universalIntent: universal.intent,
      }
    }
    return {
      parseResult: det.status === 'parsed' ? det : universal.parseResult,
      aiMeta: {
        intent: universal.intent.kind,
        source: universal.source,
        fallbackReason: 'ai_veto_disabled',
      },
      universalIntent: universal.intent,
    }
  }

  // primary: universal first, deterministic fallback when AI unavailable
  const universal = await runUniversal()
  const aiUnavailable = universal.source === 'unavailable'
    || universal.skip_reason === 'universal_parse_unavailable'
  if (!aiUnavailable) {
    const grounded = await groundModificationResult({
      supabase: args.supabase,
      userId: args.userId,
      channelRowId: args.channelRowId,
      rawMessage: args.rawMessage,
      isReply: args.isReply,
      parentSignalId: args.parentSignalId,
      isModificationClass: args.isModificationClass,
      revision: args.revision,
      det,
      universal,
    })
    if (grounded) {
      if (grounded.source === 'gpt4o') return routeStageThreeResult(grounded, det)
      return {
        parseResult: grounded.parseResult,
        aiMeta: {
          intent: grounded.intent.kind,
          source: grounded.source,
          fallbackReason: grounded.skip_reason ?? undefined,
        },
        universalIntent: grounded.intent,
      }
    }
    const reconciled = await runStageThree({
      supabase: args.supabase,
      userId: args.userId,
      channelRowId: args.channelRowId,
      signalId: args.signalId,
      rawMessage: args.rawMessage,
      isReply: args.isReply,
      parentSignalId: args.parentSignalId,
      isModificationClass: args.isModificationClass,
      revision: args.revision,
      det,
      universal,
    })
    if (reconciled) return routeStageThreeResult(reconciled, det)
  }
  if (universal.parseResult.status === 'parsed') {
    return {
      parseResult: universal.parseResult,
      aiMeta: { intent: universal.intent.kind, source: universal.source },
      universalIntent: universal.intent,
    }
  }
  if (aiUnavailable) {
    return {
      parseResult: det,
      aiMeta: { intent: 'deterministic_fallback', source: 'deterministic' },
    }
  }
  return {
    parseResult: universal.parseResult,
    aiMeta: { intent: universal.intent.kind, source: universal.source },
    universalIntent: universal.intent,
  }
}

async function logShadowDiff(
  supabase: SupabaseClient,
  args: {
    userId: string
    signalId: string
    channelRowId: string
    deterministic: ParseChannelMessageResult
    universal: UniversalParseResult
  },
): Promise<void> {
  const diff = compareParseShadowDiff(args.deterministic, args.universal.parseResult)
  if (!diff.differs) return
  try {
    await supabase.from('trade_execution_logs').insert({
      user_id: args.userId,
      signal_id: args.signalId,
      action: 'parse_shadow_diff',
      status: 'skipped',
      request_payload: {
        channel_id: args.channelRowId,
        ...diff,
        universal_kind: args.universal.intent.kind,
        universal_source: args.universal.source,
      },
    })
  } catch {
    // best-effort
  }
}

export { logShadowDiff }
