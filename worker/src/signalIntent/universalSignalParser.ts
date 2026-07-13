/**
 * Unified AI parser: extracts language-independent TradeIntent from any Telegram signal.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  enrichParsedKeywordMatch,
  parseChannelMessageSync,
  parseModificationDeterministic,
  type ChannelKeywords,
  type ChannelLexiconRow,
  type ChannelParsedSignal,
  type ParseChannelMessageResult,
} from '../parseSignal'
import { getChannelParseContext } from '../channelKeywordsCache'
import { buildAiModificationContext } from '../aiParseModification'
import { coerceMgmtSlTpFollowUpAction } from '../aiParseModification'
import { coerceAiEntrySignal } from '../aiParseEntry'
import type { ParsedSignal } from '../manualPlanning/types'
import { evaluateParsedSignalExecutionEligibility } from '../signalExecutionEligibility'
import { isManagementAction, parsedAction } from '../tradeSignalActions'
import { coerceTradeIntent } from './coerceTradeIntent'
import {
  formatExamplesForPrompt,
  loadChannelSignalExamples,
} from './loadChannelExamples'
import {
  getUniversalParseMode,
  isUniversalParseEnabled,
  universalParseFastPathConfidence,
  universalParseModel,
  universalParseStoreIntent,
  universalParseTimeoutMs,
} from './parseConfig'
import { tradeIntentToChannelParsedSignal, withStoredIntent } from './tradeIntentAdapter'
import type { TradeIntent } from './tradeIntent'
import { validateTradeIntent } from './validateTradeIntent'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''

export type UniversalParseResult = {
  parseResult: ParseChannelMessageResult
  intent: TradeIntent
  source: 'openai' | 'unavailable'
  skip_reason?: string | null
}

export type UniversalParseContext = {
  raw_message: string
  is_reply?: boolean
  revision?: {
    prior_raw_message: string
    prior_parsed_data: Record<string, unknown> | null
  }
  parent_signal?: {
    raw_message: string
    parsed_data: Record<string, unknown> | null
  } | null
  recent_signals?: Array<{
    raw_message: string
    parsed_data: Record<string, unknown> | null
    created_at: string
  }>
  channel_keywords_summary?: Record<string, string>
  channel_examples?: unknown[]
}

const UNIVERSAL_SYSTEM_PROMPT = `You extract trading intent from Telegram channel messages in ANY language.
Return strict JSON only matching this schema:
{
  "kind": "entry" | "modify" | "close" | "breakeven" | "partial_close" | "ignore" | "commentary",
  "side": "BUY" | "SELL" | null,
  "symbol": string | null,
  "entry": number[],
  "sl": number | null,
  "tp": number[],
  "sl_unit": "price" | "pips",
  "tp_unit": "price" | "pips",
  "flags": {
    "market_now": boolean,
    "re_enter": boolean,
    "open_tp": boolean,
    "partial_close_fraction": number | null
  },
  "confidence": number,
  "detected_language": string | null
}
Rules:
- Extract TRADING INTENT, never translate the message literally.
- Map instrument aliases: GOLD, OR, XAU-USD, XAU/USD → XAUUSD; SILVER → XAGUSD.
- Never invent prices not present in the message.
- New trade entries: kind entry, side BUY or SELL, entry as [price] or zone [low, high].
- SL/TP updates on open trades: kind modify (keep side from parent/recent context when omitted).
- Full close: kind close. Move SL to entry: kind breakeven. Partial close: kind partial_close.
- TP-hit announcements, status updates, "TP2 reached", ATUALIZAÇÃO without new entry → kind commentary or ignore.
- Conditional tense, retrospective discussion, macro news → kind commentary.
- confidence 0-1.`

function keywordsSummary(keywords: ChannelKeywords): Record<string, string> {
  return {
    skip: keywords.additional.skip_keyword,
    ignore: keywords.additional.ignore_keyword,
    entry: keywords.signal.entry_point,
    buy: keywords.signal.buy,
    sell: keywords.signal.sell,
    sl: keywords.signal.sl,
    tp: keywords.signal.tp,
    market: keywords.signal.market_order,
  }
}

async function callOpenAiUniversal(context: UniversalParseContext): Promise<{
  raw: Record<string, unknown> | null
  error: string | null
}> {
  if (!OPENAI_API_KEY) {
    return { raw: null, error: 'OPENAI_API_KEY not set on listener worker' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), universalParseTimeoutMs())
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: universalParseModel(),
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: UNIVERSAL_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context) },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { raw: null, error: `OpenAI HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data?.choices?.[0]?.message?.content ?? ''
    if (!content) return { raw: null, error: 'empty OpenAI response' }
    return { raw: JSON.parse(content) as Record<string, unknown>, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      raw: null,
      error: msg.includes('abort') ? `OpenAI timeout after ${universalParseTimeoutMs()}ms` : msg,
    }
  } finally {
    clearTimeout(timer)
  }
}

function intentToLegacyParsed(
  intent: TradeIntent,
  rawMessage: string,
  channelKeywords: ChannelKeywords,
): ChannelParsedSignal {
  let parsed = tradeIntentToChannelParsedSignal(intent, rawMessage)
  if (intent.kind === 'entry' && (parsed.action === 'buy' || parsed.action === 'sell')) {
    parsed = coerceAiEntrySignal(parsed as ParsedSignal) as ChannelParsedSignal
  }
  if (intent.kind === 'modify') {
    parsed = coerceMgmtSlTpFollowUpAction(parsed as ParsedSignal, 'modify') as ChannelParsedSignal
  }
  return enrichParsedKeywordMatch(parsed, rawMessage, channelKeywords)
}

function buildSkipResult(rawMessage: string, skipReason: string): UniversalParseResult {
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
    source: 'unavailable',
    skip_reason: skipReason,
    parseResult: {
      parsed: tradeIntentToChannelParsedSignal(intent, rawMessage),
      status: 'skipped',
      skip_reason: skipReason,
    },
  }
}

export async function buildUniversalParseContext(
  supabase: SupabaseClient,
  args: {
    userId: string
    channelRowId: string
    rawMessage: string
    isReply?: boolean
    parentSignalId?: string | null
    revision?: UniversalParseContext['revision']
  },
): Promise<UniversalParseContext> {
  const { keywords } = await getChannelParseContext(supabase, args.channelRowId)
  const [base, examples] = await Promise.all([
    buildAiModificationContext(supabase, {
      userId: args.userId,
      channelRowId: args.channelRowId,
      rawMessage: args.rawMessage,
      isReply: args.isReply,
      parentSignalId: args.parentSignalId,
      revision: args.revision,
    }),
    loadChannelSignalExamples(supabase, args.channelRowId),
  ])
  return {
    ...base,
    channel_keywords_summary: keywordsSummary(keywords),
    channel_examples: formatExamplesForPrompt(examples),
  }
}

export async function parseUniversalSignal(
  supabase: SupabaseClient,
  args: {
    userId: string
    channelRowId: string
    rawMessage: string
    isReply?: boolean
    parentSignalId?: string | null
    revision?: UniversalParseContext['revision']
  },
): Promise<UniversalParseResult> {
  if (!isUniversalParseEnabled() || getUniversalParseMode() === 'off') {
    return buildSkipResult(args.rawMessage, 'universal_parse_disabled')
  }

  const { keywords, lexicon } = await getChannelParseContext(supabase, args.channelRowId)
  const context = await buildUniversalParseContext(supabase, args)
  const { raw, error } = await callOpenAiUniversal(context)

  if (!raw) {
    return buildSkipResult(args.rawMessage, error ?? 'universal_parse_unavailable')
  }

  let intent = coerceTradeIntent(raw)
  const validation = validateTradeIntent(intent, args.rawMessage)
  intent = validation.intent

  if (!validation.ok) {
    return {
      intent,
      source: 'openai',
      skip_reason: validation.reason,
      parseResult: {
        parsed: tradeIntentToChannelParsedSignal(intent, args.rawMessage),
        status: 'skipped',
        skip_reason: validation.reason,
      },
    }
  }

  if (intent.kind === 'commentary' || intent.kind === 'ignore') {
    return {
      intent,
      source: 'openai',
      skip_reason: 'AI classified as non-actionable',
      parseResult: {
        parsed: tradeIntentToChannelParsedSignal(intent, args.rawMessage),
        status: 'skipped',
        skip_reason: 'AI classified as non-actionable',
      },
    }
  }

  let parsed = intentToLegacyParsed(intent, args.rawMessage, keywords)
  const eligibility = evaluateParsedSignalExecutionEligibility(parsed, args.rawMessage, keywords)
  if ((parsed.action === 'buy' || parsed.action === 'sell') && !eligibility.eligible) {
    return {
      intent,
      source: 'openai',
      skip_reason: eligibility.skipReason ?? 'entry_not_execution_eligible',
      parseResult: {
        parsed,
        status: 'skipped',
        skip_reason: eligibility.skipReason ?? 'entry_not_execution_eligible',
      },
    }
  }

  if (universalParseStoreIntent()) {
    parsed = withStoredIntent(parsed, intent)
  }

  return {
    intent,
    source: 'openai',
    skip_reason: null,
    parseResult: {
      parsed,
      status: parsed.action === 'ignore' ? 'skipped' : 'parsed',
      skip_reason: parsed.action === 'ignore' ? 'AI classified as non-actionable' : null,
    },
  }
}

export function parseDeterministicForUniversal(
  rawMessage: string,
  keywords: ChannelKeywords,
  lexicon: ChannelLexiconRow | null,
  isModificationClass: boolean,
): ParseChannelMessageResult {
  if (isModificationClass) {
    return parseModificationDeterministic(rawMessage, keywords, lexicon)
  }
  return parseChannelMessageSync(rawMessage, keywords, lexicon)
}

export function deterministicQualifiesForFastPath(
  det: ParseChannelMessageResult,
  rawMessage: string,
  keywords: ChannelKeywords,
): boolean {
  if (det.status !== 'parsed' || det.parsed.action === 'ignore') return false
  const conf = typeof det.parsed.confidence === 'number' ? det.parsed.confidence : 0
  if (conf < universalParseFastPathConfidence()) return false

  const action = parsedAction(det.parsed)
  if (isManagementAction(action)) return true

  if (action === 'buy' || action === 'sell') {
    return evaluateParsedSignalExecutionEligibility(det.parsed, rawMessage, keywords).eligible
  }
  return false
}

/** Legacy bridge: convert universal result using same path as old AI parsers. */
export function universalResultToParseResult(result: UniversalParseResult): ParseChannelMessageResult {
  return result.parseResult
}
