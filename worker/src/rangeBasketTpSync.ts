import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketBrokerClient } from './fxsocketClient'
import {
  fetchOpenBrokerTickets,
  runBasketLegModifies,
  type BasketOpenLeg,
  type BasketSymbolParams,
} from './basketSlTpReconcile'
import type { ManualTpLot } from './manualPlanning/types'
import {
  buildEntryQualityTakeProfitMap,
  buildRangeBasketPerLegStopTargets,
  resolveRangeBasketTpPhase,
  type EntryQualityLeg,
  type PerLegStopTargetLike,
} from './manualPlanning/tpBucketDistribution'
import type { PlannerResult } from './manualPlanner'
import { mergePlanImmediateOrders } from './multiTradeMerge'

export type RangeBasketTpSyncArgs = {
  supabase: SupabaseClient
  api: FxsocketBrokerClient
  uuid: string
  symbol: string
  direction: 'buy' | 'sell'
  baseLot: number
  params: BasketSymbolParams | null
  signalId: string
  userId: string
  brokerAccountId: string
  manual: { range_trading?: boolean; tp_lots?: ManualTpLot[] | null }
  parsed: { sl?: number | null; tp?: number[] | null }
  plan?: PlannerResult | null
  /** When set, force phase B (range layer just fired). */
  forceLayeringRebalance?: boolean
}

function positiveTps(parsed: { tp?: number[] | null }): number[] {
  return (parsed.tp ?? []).filter(
    (t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0,
  )
}

function toEntryQualityLeg(tr: BasketOpenLeg): EntryQualityLeg {
  return {
    id: tr.id,
    entryPrice: Number(tr.entry_price ?? 0),
    openedAt: String(tr.opened_at ?? ''),
  }
}

/** Infer instant leg count when the entry plan is unavailable (post-layer rebalance). */
export function estimatePlanImmediateLegCount(args: {
  openLegCount: number
  activePendingCount: number
  maxPendingStepIdx: number
  planImmediateLegCount?: number
}): number {
  if (args.planImmediateLegCount != null && args.planImmediateLegCount > 0) {
    return args.planImmediateLegCount
  }
  const firedPendingApprox = Math.max(0, args.maxPendingStepIdx - args.activePendingCount)
  if (args.maxPendingStepIdx > 0) {
    return Math.max(0, args.openLegCount - firedPendingApprox)
  }
  return args.openLegCount
}

export function resolveRangeBasketLegCounts(args: {
  openLegCount: number
  planImmediateLegCount: number
  activePendingCount: number
  maxPendingStepIdx: number
}): {
  immediateLegCount: number
  firedRangeLegCount: number
  phase: ReturnType<typeof resolveRangeBasketTpPhase>
} {
  const firedPendingApprox = Math.max(0, args.maxPendingStepIdx - args.activePendingCount)
  const immediateLegCount = Math.max(
    args.planImmediateLegCount,
    Math.max(0, args.openLegCount - firedPendingApprox),
  )
  const firedRangeLegCount = Math.max(0, args.openLegCount - immediateLegCount)
  const phase = resolveRangeBasketTpPhase({
    openLegCount: args.openLegCount,
    immediateLegCount,
    firedRangeLegCount,
  })
  return { immediateLegCount, firedRangeLegCount, phase }
}

export function buildRangeBasketTpTargets(args: {
  familyTrades: BasketOpenLeg[]
  plan: PlannerResult | null | undefined
  parsed: { sl?: number | null; tp?: number[] | null }
  tpLots?: ManualTpLot[] | null
  direction: 'buy' | 'sell'
  activePendingCount: number
  maxPendingStepIdx: number
  forceLayeringRebalance?: boolean
}): PerLegStopTargetLike[] {
  const {
    familyTrades, plan, parsed, tpLots, direction, activePendingCount, maxPendingStepIdx,
    forceLayeringRebalance,
  } = args
  if (!familyTrades.length) return []

  const fromPlan = (plan ? mergePlanImmediateOrders(plan) : []).map(o => ({
    stoploss: Number(o.stoploss) || 0,
    takeprofit: Number(o.takeprofit) || 0,
  }))
  const hasSl = typeof parsed.sl === 'number' && Number.isFinite(parsed.sl) && parsed.sl > 0
  const parsedTps = positiveTps(parsed)
  const sl = hasSl ? (parsed.sl as number) : (fromPlan[0]?.stoploss ?? 0)
  let finalTps = parsedTps
  if (!finalTps.length && fromPlan.length > 0) {
    finalTps = fromPlan
      .map(o => o.takeprofit)
      .filter(tp => typeof tp === 'number' && Number.isFinite(tp) && tp > 0)
  }

  const planImmediateLegCount = estimatePlanImmediateLegCount({
    openLegCount: familyTrades.length,
    activePendingCount,
    maxPendingStepIdx,
    planImmediateLegCount: plan ? mergePlanImmediateOrders(plan).length : undefined,
  })
  const { immediateLegCount, phase: detectedPhase } = resolveRangeBasketLegCounts({
    openLegCount: familyTrades.length,
    planImmediateLegCount,
    activePendingCount,
    maxPendingStepIdx,
  })
  const phase = forceLayeringRebalance ? 'layering_rebalance' : detectedPhase
  const isBuy = direction === 'buy'

  const openLegs = familyTrades.map(tr => ({
    ...toEntryQualityLeg(tr),
    stoploss: sl,
  }))

  return buildRangeBasketPerLegStopTargets({
    phase,
    openLegs,
    immediateLegCount,
    isBuy,
    stoploss: sl,
    finalTps,
    tpLots,
  })
}

async function loadPendingMeta(
  supabase: SupabaseClient,
  brokerAccountId: string,
  signalId: string,
): Promise<{ activePendingCount: number; maxPendingStepIdx: number }> {
  const { data: pendingRows } = await supabase
    .from('range_pending_legs')
    .select('step_idx, status')
    .eq('broker_account_id', brokerAccountId)
    .eq('signal_id', signalId)
    .limit(500)
  const rows = pendingRows ?? []
  const activePendingCount = rows.filter(
    r => r.status === 'pending' || r.status === 'claimed',
  ).length
  const maxPendingStepIdx = Math.max(0, ...rows.map(r => Number(r.step_idx) || 0))
  return { activePendingCount, maxPendingStepIdx }
}

async function logRangeBasketTpRebalance(
  supabase: SupabaseClient,
  args: {
    userId: string
    signalId: string
    brokerAccountId: string
    openLegs: number
    phase: string
    forceLayeringRebalance?: boolean
    modified: number
    attempted: number
    failed: number
    tpCounts: Record<string, number>
  },
): Promise<void> {
  try {
    await supabase.from('trade_execution_logs').insert({
      user_id: args.userId,
      signal_id: args.signalId,
      broker_account_id: args.brokerAccountId,
      action: 'range_basket_tp_rebalance',
      status: args.modified > 0 || args.attempted === 0 ? 'success' : 'failed',
      request_payload: {
        open_legs: args.openLegs,
        phase: args.phase,
        force_layering_rebalance: args.forceLayeringRebalance === true,
        modified: args.modified,
        attempted: args.attempted,
        failed: args.failed,
        target_tp_counts: args.tpCounts,
      } as unknown as Record<string, unknown>,
    })
  } catch { /* best-effort */ }
}

export async function patchPendingRangeLegTakeProfits(args: {
  supabase: SupabaseClient
  brokerAccountId: string
  signalId: string
  isBuy: boolean
  finalTps: number[]
  tpLots?: ManualTpLot[] | null
  openLegs: EntryQualityLeg[]
}): Promise<number> {
  const { supabase, brokerAccountId, signalId, isBuy, finalTps, tpLots, openLegs } = args
  const { data: pendingRows } = await supabase
    .from('range_pending_legs')
    .select('id, trigger_price, step_idx')
    .eq('broker_account_id', brokerAccountId)
    .eq('signal_id', signalId)
    .in('status', ['pending', 'claimed'])
    .limit(500)
  if (!pendingRows?.length) return 0

  const projected: EntryQualityLeg[] = [
    ...openLegs,
    ...pendingRows.map(row => ({
      id: `pending:${row.id}`,
      entryPrice: Number(row.trigger_price ?? 0),
      openedAt: `pending:${String(row.step_idx ?? 0).padStart(6, '0')}`,
    })),
  ]
  const slotLegCount = openLegs.length + pendingRows.length
  const tpMap = buildEntryQualityTakeProfitMap({
    legs: projected,
    isBuy,
    slotLegCount,
    finalTps,
    tpLots,
  })

  let updated = 0
  for (const row of pendingRows) {
    const tp = tpMap.get(`pending:${row.id}`)
    if (typeof tp !== 'number' || !(tp > 0)) continue
    const { error } = await supabase
      .from('range_pending_legs')
      .update({ takeprofit: tp })
      .eq('id', row.id)
    if (!error) updated += 1
  }
  return updated
}

/** Sync SL/TP on all open legs for a range-layering basket (phase-aware). */
export async function syncRangeBasketTakeProfits(args: RangeBasketTpSyncArgs): Promise<void> {
  if (args.manual.range_trading !== true) return

  const { data: familyRows, error } = await args.supabase
    .from('trades')
    .select('id,signal_id,metaapi_order_id,opened_at,lot_size,sl,tp,entry_price,direction,symbol')
    .eq('broker_account_id', args.brokerAccountId)
    .eq('signal_id', args.signalId)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })
    .limit(500)
  if (error || !(familyRows ?? []).length) return

  const familyTrades = (familyRows ?? []) as BasketOpenLeg[]
  const { activePendingCount, maxPendingStepIdx } = await loadPendingMeta(
    args.supabase,
    args.brokerAccountId,
    args.signalId,
  )

  const perLegTargets = buildRangeBasketTpTargets({
    familyTrades,
    plan: args.plan,
    parsed: args.parsed,
    tpLots: args.manual.tp_lots,
    direction: args.direction,
    activePendingCount,
    maxPendingStepIdx,
    forceLayeringRebalance: args.forceLayeringRebalance,
  })
  if (!perLegTargets.length) return

  const planImmediateLegCount = estimatePlanImmediateLegCount({
    openLegCount: familyTrades.length,
    activePendingCount,
    maxPendingStepIdx,
    planImmediateLegCount: args.plan ? mergePlanImmediateOrders(args.plan).length : undefined,
  })
  const { phase } = resolveRangeBasketLegCounts({
    openLegCount: familyTrades.length,
    planImmediateLegCount,
    activePendingCount,
    maxPendingStepIdx,
  })
  const effectivePhase = args.forceLayeringRebalance ? 'layering_rebalance' : phase

  let openedTickets: Set<number> | null = null
  try {
    openedTickets = await fetchOpenBrokerTickets(args.api, args.uuid)
  } catch { /* optional */ }

  const parsedTps = positiveTps(args.parsed)
  const isBuy = args.direction === 'buy'

  if (effectivePhase === 'layering_rebalance') {
    try {
      await patchPendingRangeLegTakeProfits({
        supabase: args.supabase,
        brokerAccountId: args.brokerAccountId,
        signalId: args.signalId,
        isBuy,
        finalTps: parsedTps.length
          ? parsedTps
          : perLegTargets.map(t => t.takeprofit).filter(tp => tp > 0),
        tpLots: args.manual.tp_lots,
        openLegs: familyTrades.map(toEntryQualityLeg),
      })
    } catch (err) {
      console.warn(
        `[rangeBasketTpSync] pending TP patch failed signal=${args.signalId}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  const tpCounts: Record<string, number> = {}
  for (const target of perLegTargets) {
    const key = String(target.takeprofit)
    tpCounts[key] = (tpCounts[key] ?? 0) + 1
  }

  let modifyResult: Awaited<ReturnType<typeof runBasketLegModifies>> | null = null
  try {
    modifyResult = await runBasketLegModifies({
      supabase: args.supabase,
      api: args.api,
      uuid: args.uuid,
      symbol: args.symbol,
      direction: args.direction,
      baseLot: args.baseLot,
      params: args.params,
      signalId: args.signalId,
      userId: args.userId,
      brokerAccountId: args.brokerAccountId,
      familyTrades,
      perLegTargets,
      signalTps: parsedTps,
      tpLots: args.manual.tp_lots,
      nImmCwe: 0,
      overrideTp: null,
      strictEntryPrefetch: null,
      openedTickets,
      skipAlreadySynced: args.forceLayeringRebalance !== true,
    })
  } catch (err) {
    console.warn(
      `[rangeBasketTpSync] leg modify failed signal=${args.signalId} broker=${args.brokerAccountId}:`,
      err instanceof Error ? err.message : String(err),
    )
  }

  await logRangeBasketTpRebalance(args.supabase, {
    userId: args.userId,
    signalId: args.signalId,
    brokerAccountId: args.brokerAccountId,
    openLegs: familyTrades.length,
    phase: effectivePhase,
    forceLayeringRebalance: args.forceLayeringRebalance,
    modified: modifyResult?.summary.modified ?? 0,
    attempted: modifyResult?.summary.attempted ?? 0,
    failed: modifyResult?.summary.failed ?? 0,
    tpCounts,
  })

  if (modifyResult && modifyResult.summary.modified > 0) {
    console.log(
      `[rangeBasketTpSync] rebalanced signal=${args.signalId} broker=${args.brokerAccountId}`
      + ` open=${familyTrades.length} phase=${effectivePhase}`
      + ` modified=${modifyResult.summary.modified}/${modifyResult.summary.attempted}`,
    )
  }
}
