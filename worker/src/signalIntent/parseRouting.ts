import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelKeywords, ChannelLexiconRow, ParseChannelMessageResult } from '../parseSignal'
import { getUniversalParseMode } from './parseConfig'
import { compareParseShadowDiff } from './shadowDiff'
import {
  deterministicQualifiesForFastPath,
  parseDeterministicForUniversal,
  parseUniversalSignal,
  type UniversalParseResult,
} from './universalSignalParser'

export type RoutedParseResult = {
  parseResult: ParseChannelMessageResult
  aiMeta?: { intent: string; source: string }
  universalIntent?: UniversalParseResult['intent']
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
    if (universal.parseResult.status === 'parsed') {
      return {
        parseResult: universal.parseResult,
        aiMeta: { intent: universal.intent.kind, source: universal.source },
        universalIntent: universal.intent,
      }
    }
    return {
      parseResult: det.status === 'parsed' ? det : universal.parseResult,
      aiMeta: { intent: universal.intent.kind, source: universal.source },
      universalIntent: universal.intent,
    }
  }

  // primary: universal first, deterministic fallback when AI unavailable
  const universal = await runUniversal()
  if (universal.parseResult.status === 'parsed') {
    return {
      parseResult: universal.parseResult,
      aiMeta: { intent: universal.intent.kind, source: universal.source },
      universalIntent: universal.intent,
    }
  }
  if (universal.skip_reason === 'universal_parse_unavailable' || universal.source === 'unavailable') {
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
