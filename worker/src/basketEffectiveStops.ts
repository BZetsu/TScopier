/**
 * Single source of truth for open-basket SL/TP authority (anchor vs adjust vs channel memory).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  channelParamsPredateBasket,
  loadChannelActiveTradeParamsForSymbol,
  type ChannelActiveTradeParams,
} from './channelActiveTradeParams'
import { mgmtSignalMatchesBasketSymbol } from './basketModFollowUp'
import type { BasketOpenLeg } from './basketSlTpReconcile'
import { coercePositiveTpLevels, type RangeBasketParsedSlice } from './rangeBasketTpSync'

export type EffectiveStopSource = 'mgmt_signal' | 'channel_memory' | 'anchor' | 'leg_consensus'

export type EffectiveBasketStops = {
  stoploss: number
  tpLevels: number[]
  parsedSlice: RangeBasketParsedSlice
  source: EffectiveStopSource
  sourceSignalId?: string
  anchorSl: number
}

type ParsedMgmtRow = {
  action?: string
  symbol?: string | null
  sl?: number | null
  tp?: number[] | null
}

function sanitizeLevel(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function unanimousLegSl(familyTrades: BasketOpenLeg[] | undefined): number | null {
  if (!familyTrades?.length) return null
  const levels = new Set<number>()
  for (const tr of familyTrades) {
    const sl = sanitizeLevel(tr.sl)
    if (sl <= 0) return null
    levels.add(sl)
  }
  if (levels.size !== 1) return null
  return [...levels][0]!
}

/** Pure SL priority for unit tests. */
export function resolveEffectiveStoplossPriority(args: {
  anchorSl: number
  mgmtSl: number | null
  channelSl: number | null
  legConsensus: number | null
}): { stoploss: number; source: EffectiveStopSource } {
  const mgmt = args.mgmtSl != null && args.mgmtSl > 0 ? args.mgmtSl : null
  if (mgmt != null) return { stoploss: mgmt, source: 'mgmt_signal' }

  const channel = args.channelSl != null && args.channelSl > 0 ? args.channelSl : null
  if (channel != null) return { stoploss: channel, source: 'channel_memory' }

  const anchor = args.anchorSl > 0 ? args.anchorSl : 0
  const consensus = args.legConsensus != null && args.legConsensus > 0 ? args.legConsensus : null
  if (consensus != null && (anchor <= 0 || consensus !== anchor)) {
    return { stoploss: consensus, source: 'leg_consensus' }
  }

  return { stoploss: anchor, source: anchor > 0 ? 'anchor' : 'anchor' }
}

export async function findLatestMgmtModifySl(
  supabase: SupabaseClient,
  args: {
    userId: string
    channelId: string
    basketCreatedAt: string
    symbol: string
  },
): Promise<{ sl: number; signalId: string; tpLevels: number[] } | null> {
  const { data: candidates, error } = await supabase
    .from('signals')
    .select('id, parsed_data, created_at')
    .eq('user_id', args.userId)
    .eq('channel_id', args.channelId)
    .in('status', ['parsed', 'executed'])
    .gte('created_at', args.basketCreatedAt)
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    console.warn(`[effectiveStops] mgmt signal scan failed: ${error.message}`)
    return null
  }

  for (const row of candidates ?? []) {
    const parsed = row.parsed_data as ParsedMgmtRow | null
    if (!parsed?.action) continue
    if (String(parsed.action).toLowerCase() !== 'modify') continue
    if (!mgmtSignalMatchesBasketSymbol(parsed, args.symbol)) continue
    const sl = sanitizeLevel(parsed.sl)
    if (sl <= 0) continue
    return {
      sl,
      signalId: String(row.id),
      tpLevels: coercePositiveTpLevels(parsed.tp),
    }
  }
  return null
}

export type ResolveEffectiveBasketStopsArgs = {
  supabase: SupabaseClient
  userId: string
  channelId: string | null
  anchorSignalId: string
  symbol: string
  basketCreatedAt: string | null
  anchorParsed: RangeBasketParsedSlice
  familyTrades?: BasketOpenLeg[]
}

export async function resolveEffectiveBasketStops(
  args: ResolveEffectiveBasketStopsArgs,
): Promise<EffectiveBasketStops> {
  const anchorSl = sanitizeLevel(args.anchorParsed.sl)
  let tpLevels = coercePositiveTpLevels(args.anchorParsed.tp)

  let mgmtSl: number | null = null
  let sourceSignalId: string | undefined
  if (args.channelId && args.basketCreatedAt) {
    const mgmt = await findLatestMgmtModifySl(args.supabase, {
      userId: args.userId,
      channelId: args.channelId,
      basketCreatedAt: args.basketCreatedAt,
      symbol: args.symbol,
    })
    if (mgmt) {
      mgmtSl = mgmt.sl
      sourceSignalId = mgmt.signalId
      if (mgmt.tpLevels.length) tpLevels = mgmt.tpLevels
    }
  }

  let channelSl: number | null = null
  let channelParams: ChannelActiveTradeParams | null = null
  if (args.channelId) {
    channelParams = await loadChannelActiveTradeParamsForSymbol(
      args.supabase,
      args.userId,
      args.channelId,
      args.symbol,
    )
    if (channelParams && args.basketCreatedAt && channelParamsPredateBasket(channelParams, args.basketCreatedAt)) {
      channelParams = null
    } else if (channelParams) {
      channelSl = channelParams.stoploss != null ? sanitizeLevel(channelParams.stoploss) : null
      if (channelParams.tpLevels.length > 0 && !mgmtSl) {
        tpLevels = [...channelParams.tpLevels]
      }
    }
  }

  const legConsensus = unanimousLegSl(args.familyTrades)
  const { stoploss, source } = resolveEffectiveStoplossPriority({
    anchorSl,
    mgmtSl,
    channelSl: channelSl && channelSl > 0 ? channelSl : null,
    legConsensus,
  })

  const parsedSlice: RangeBasketParsedSlice = {
    sl: stoploss > 0 ? stoploss : args.anchorParsed.sl,
    tp: tpLevels.length ? tpLevels : args.anchorParsed.tp,
  }

  return {
    stoploss,
    tpLevels,
    parsedSlice,
    source,
    sourceSignalId,
    anchorSl,
  }
}

export function logEffectiveBasketStops(
  prefix: string,
  anchorSignalId: string,
  effective: EffectiveBasketStops,
): void {
  const tag = prefix.endsWith(' ') ? prefix.slice(0, -1) : prefix
  console.log(
    `${tag} [effectiveStops] basket=${anchorSignalId} sl=${effective.stoploss}`
    + ` source=${effective.source}${effective.sourceSignalId ? ` signal=${effective.sourceSignalId}` : ''}`
    + ` anchor_sl=${effective.anchorSl}`,
  )
}
