import {
  isBrokerDisconnectedMessage,
  isOrderOpTimedOutMessage,
  FxsocketBrokerClient,
  MtOperation,
} from '../fxsocketClient'
import { isMtBridgeGlitchMessage } from '../brokerConnectError'
import type { ChannelKeywords, ManualSettings, PlannerResult, VirtualPendingLeg } from '../manualPlanner'
import { autoManagementTradeSnapshot } from '../autoManagement'
import { stripInvalidStopsForSide } from '../channelActiveTradeParams'
import { isInvalidStopsError } from '../orderModifySafe'
import { trailingTradeRowSnapshot } from '../trailingStop'
import { applyPostFillFollowUp, type PostFillTradeLeg } from '../postFillFollowUp'
import type { TradeExecutorContext } from './context'
import { clampOrderStops, isBuySideOp, resolveBurstFillAnchor, type Leg } from './helpers'
import type { BrokerRow, ParsedSignal, SendOrderOutcome, SignalRow, SymbolCacheEntry, SymbolMappingResult } from './types'
import { isV2 } from '../engine/executionMode'
import { getFxClient, toMtPlatform } from '../engine/fxClient'
import type { FxOpenOrder } from '../engine/fxContract'
import { SKIP_REASON_ENTRY_NOT_OPENED } from '../manualPlanner'
import { materializeBrokerRangePendingLegs } from './materializeBrokerRangePendingLegs'
import type { PreparedEntry } from './entryPrepare'
import {
  buildPipelineCorrelation,
  emitPipelineEvent,
  setPipelineTimestamp,
} from '../pipelineTimestamps'

/** Normalized broker fill shape shared by the v1 client and the v2 fxClient. */
type NormalizedFill = {
  ticket: number
  openPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  lots: number | null
}

export type SendImmediateLegsInput = {
  ctx: TradeExecutorContext
  signal: SignalRow
  parsed: ParsedSignal
  broker: BrokerRow
  manual: ManualSettings
  api: FxsocketBrokerClient
  uuid: string
  symbol: string
  requestedSymbol: string
  mapping: SymbolMappingResult
  params: SymbolCacheEntry | null
  legs: Leg[]
  liveEntryFast: boolean
  pipelineT0?: number
  strictEntryPrefetch: { bid: number; ask: number } | null
  channelDelayMs: number
  channelDelaySkipped: boolean
  deferVirtualAnchor: boolean
  deferBrokerRangePendingMaterialize: boolean
  brokerPendingMode: boolean
  prepAnchor: number | null
  prepAnchorSource: 'signal' | 'quote' | 'fill' | 'unknown'
  virtualPendings: VirtualPendingLeg[]
  plan: PlannerResult
  materializedVirtuals: boolean
  strictBrokerPlaced: boolean
  strictDeferred: boolean
  op: MtOperation
  channelKeywords: ChannelKeywords | null
  baseLot: number
  syncMultiLegTps: boolean
  prep: PreparedEntry
}

export async function sendImmediateLegs(input: SendImmediateLegsInput): Promise<SendOrderOutcome> {
  const {
    ctx, signal, parsed, broker, manual, api, uuid, symbol, requestedSymbol, mapping, params,
    legs, liveEntryFast, pipelineT0, strictEntryPrefetch, channelDelayMs, channelDelaySkipped,
    deferVirtualAnchor, deferBrokerRangePendingMaterialize, brokerPendingMode,
    prepAnchor, prepAnchorSource, virtualPendings, plan, materializedVirtuals, strictBrokerPlaced,
    strictDeferred, op, channelKeywords, baseLot, syncMultiLegTps, prep,
  } = input

  if (legs.length === 0) {
    // No immediates — virtual range ladder and/or broker strict-entry pending.
    return (materializedVirtuals || strictBrokerPlaced)
      ? { openedOrMerged: true, channelDelayMs, channelDelaySkipped }
      : {
        channelDelayMs,
        channelDelaySkipped,
        failureReason: SKIP_REASON_ENTRY_NOT_OPENED,
      }
  }

  if (manual.trade_style !== 'multi' && legs.length > 1) {
    console.error(
      `[tradeExecutor] single trade_style aborting ${legs.length} legs signal=${signal.id} broker=${broker.id}`,
    )
  }
  const sendLegs = manual.trade_style !== 'multi' && legs.length > 1 ? legs.slice(0, 1) : legs

  const totalCount = sendLegs.length
  const orderLogContext: Record<string, unknown> = {
    signal_symbol: parsed.symbol ?? null,
    trade_symbol: requestedSymbol,
  }
  if (mapping.whitelist.length > 0) {
    orderLogContext.allowed_symbols = mapping.whitelist
  }

  const filledLegs: PostFillTradeLeg[] = []
  let lastSendError: string | null = null

  // v2 entries fire PROTECTED-at-send through the strict fxClient (bounded timeout,
  // strict retcode, no blind 3x retries) instead of the old client. One pre-burst
  // OpenedOrders snapshot powers ambiguous-send adoption so retries never duplicate.
  const useV2 = isV2({ brokerAccountId: broker.id, userId: signal.user_id })
  const v2Platform = toMtPlatform(broker.platform)
  const v2Snapshot: FxOpenOrder[] = useV2
    ? await getFxClient().openedOrders(uuid, v2Platform).catch(() => [])
    : []

  const sendLeg = async (leg: Leg): Promise<boolean> => {
    let args = leg.args
    const isBuyLeg = isBuySideOp(String(args.operation))
    const isMarket = args.operation === 'Buy' || args.operation === 'Sell'
    if (isMarket && (!args.price || args.price <= 0) && (strictEntryPrefetch || api)) {
      try {
        const q = strictEntryPrefetch ?? await api!.quote(uuid, symbol)
        args = { ...args, price: isBuyLeg ? q.ask : q.bid }
      } catch {
        /* clamp may no-op without ref */
      }
    }
    const refPx = Number(args.price) || 0
    if (refPx > 0) {
      const stripped = stripInvalidStopsForSide({
        stoploss: Number(args.stoploss) || 0,
        takeprofit: Number(args.takeprofit) || 0,
        referencePrice: refPx,
        isBuy: isBuyLeg,
      })
      if (stripped.stripped.length > 0) {
        console.warn(
          `[tradeExecutor] stripped invalid stops signal=${signal.id} broker=${broker.id}`
          + ` ref=${refPx} isBuy=${isBuyLeg}: ${stripped.stripped.join(', ')}`,
        )
        args = { ...args, stoploss: stripped.stoploss, takeprofit: stripped.takeprofit }
      }
    }
    // Final SL/TP clamp using the actual market/entry price as the reference.
    const clamped = clampOrderStops(args, params)
    if (clamped.adjustments.length > 0) {
      console.warn(
        `[tradeExecutor] stops clamped signal=${signal.id} broker=${broker.id} symbol=${args.symbol} op=${args.operation}: ${clamped.adjustments.join(', ')}`,
      )
    }
    args = clamped.args
    let sendArgs = args
    const plannedSl = Number(args.stoploss) || 0
    const plannedTp = Number(args.takeprofit) || 0
    const t0 = Date.now()
    if (liveEntryFast && signal.pipeline_ts && signal.pipeline_ts.t_first_broker_send == null) {
      setPipelineTimestamp(signal.pipeline_ts, 'broker_request_started_at', t0)
    } else if (signal.pipeline_ts && signal.pipeline_ts.broker_request_started_at == null) {
      setPipelineTimestamp(signal.pipeline_ts, 'broker_request_started_at', t0)
    }

    let stopsFallback = false
    let result: NormalizedFill | null = null
    let lastAttemptError: string
    let correlation = buildPipelineCorrelation({
      userId: signal.user_id,
      signalId: signal.id,
      channelId: signal.channel_id,
      telegramMessageId: signal.telegram_message_id,
      brokerAccountId: broker.id,
      executionAttemptId: `${signal.id}:${broker.id}:${leg.idx}:1`,
      brokerRequestId: `${signal.id}:${broker.id}:${leg.idx}`,
      dispatchSource: signal.dispatch_source,
    })

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const attemptNo = attempt + 1
        correlation = buildPipelineCorrelation({
          userId: signal.user_id,
          signalId: signal.id,
          channelId: signal.channel_id,
          telegramMessageId: signal.telegram_message_id,
          brokerAccountId: broker.id,
          executionAttemptId: `${signal.id}:${broker.id}:${leg.idx}:${attemptNo}`,
          brokerRequestId: `${signal.id}:${broker.id}:${leg.idx}`,
          dispatchSource: signal.dispatch_source,
        })
        if (useV2) {
          const sendPromise = getFxClient().orderSend(
            uuid,
            v2Platform,
            {
              symbol: sendArgs.symbol,
              operation: sendArgs.operation,
              volume: sendArgs.volume,
              price: Number(sendArgs.price) > 0 ? Number(sendArgs.price) : undefined,
              stopLoss: Number(sendArgs.stoploss) > 0 ? Number(sendArgs.stoploss) : undefined,
              takeProfit: Number(sendArgs.takeprofit) > 0 ? Number(sendArgs.takeprofit) : undefined,
              comment: sendArgs.comment,
              slippage: sendArgs.slippage,
              expertId: sendArgs.expertID,
            },
            { anchorSignalId: signal.id, legIndex: leg.idx, preSnapshot: v2Snapshot },
          )
          emitPipelineEvent({
            event: 'broker_request_started',
            correlation,
            timestamps: signal.pipeline_ts,
            outcome: 'started',
            path: 'fxsocket_v2',
            extra: {
              symbol: sendArgs.symbol,
              operation: sendArgs.operation,
              leg: leg.idx + 1,
              total: totalCount,
              attempt: attemptNo,
            },
          }, { deferLog: true })
          const r = await sendPromise
          if (!r.ok || !r.ticket) throw new Error(r.message || `v2 order_send rejected (${r.retcodeName})`)
          result = {
            ticket: r.ticket,
            openPrice: r.price,
            stopLoss: Number(sendArgs.stoploss) > 0 ? Number(sendArgs.stoploss) : null,
            takeProfit: Number(sendArgs.takeprofit) > 0 ? Number(sendArgs.takeprofit) : null,
            lots: r.volume ?? sendArgs.volume,
          }
        } else {
          const sendPromise = api.orderSend(uuid, sendArgs)
          emitPipelineEvent({
            event: 'broker_request_started',
            correlation,
            timestamps: signal.pipeline_ts,
            outcome: 'started',
            path: 'fxsocket_v1',
            extra: {
              symbol: sendArgs.symbol,
              operation: sendArgs.operation,
              leg: leg.idx + 1,
              total: totalCount,
              attempt: attemptNo,
            },
          }, { deferLog: true })
          const raw = await sendPromise
          result = {
            ticket: raw.ticket,
            openPrice: raw.openPrice ?? null,
            stopLoss: raw.stopLoss ?? null,
            takeProfit: raw.takeProfit ?? null,
            lots: raw.lots ?? null,
          }
        }
        break
      } catch (err) {
        setPipelineTimestamp(signal.pipeline_ts ?? (signal.pipeline_ts = {}), 'broker_response_received_at', Date.now())
        lastAttemptError = err instanceof Error ? err.message : String(err)
        const hasStops = (Number(sendArgs.stoploss) || 0) > 0 || (Number(sendArgs.takeprofit) || 0) > 0
        if (attempt === 0 && isInvalidStopsError(lastAttemptError) && hasStops) {
          console.warn(
            `[tradeExecutor] retry without stops signal=${signal.id} broker=${broker.id} leg=${leg.idx + 1}/${totalCount}`
            + ` reason="${lastAttemptError}" (sl=${sendArgs.stoploss} tp=${sendArgs.takeprofit})`,
          )
          sendArgs = { ...sendArgs, stoploss: 0, takeprofit: 0 }
          stopsFallback = true
          continue
        }
        lastSendError = lastAttemptError
        if (isBrokerDisconnectedMessage(lastAttemptError) && !isMtBridgeGlitchMessage(lastAttemptError)) {
          await ctx.markBrokerSessionDown(broker, uuid, lastAttemptError)
        }
        console.error(
          `[tradeExecutor] OrderSend failed signal=${signal.id} broker=${broker.id} leg=${leg.idx + 1}/${totalCount} op=${sendArgs.operation} price=${sendArgs.price ?? 0}:`,
          lastAttemptError,
        )
        await ctx.supabase.from('trade_execution_logs').insert({
          user_id: signal.user_id,
          signal_id: signal.id,
          broker_account_id: broker.id,
          action: 'order_send',
          status: 'failed',
          request_payload: { ...sendArgs, ...orderLogContext } as unknown as Record<string, unknown>,
          error_message: lastAttemptError,
        })
        emitPipelineEvent({
          event: isOrderOpTimedOutMessage(lastAttemptError) ? 'execution_ambiguous' : 'broker_request_failed',
          correlation,
          timestamps: signal.pipeline_ts,
          outcome: 'failed',
          path: useV2 ? 'fxsocket_v2' : 'fxsocket_v1',
          error_code: lastAttemptError.slice(0, 120),
          extra: {
            symbol: sendArgs.symbol,
            operation: sendArgs.operation,
            leg: leg.idx + 1,
            total: totalCount,
          },
        })
        return false
      }
    }

    if (!result) return false

    const latencyMs = Date.now() - t0
    if (liveEntryFast && signal.pipeline_ts) {
      setPipelineTimestamp(signal.pipeline_ts, 'broker_response_received_at', Date.now())
      setPipelineTimestamp(signal.pipeline_ts, 'broker_execution_confirmed_at', Date.now())
    } else if (signal.pipeline_ts) {
      setPipelineTimestamp(signal.pipeline_ts, 'broker_response_received_at', Date.now())
      setPipelineTimestamp(signal.pipeline_ts, 'broker_execution_confirmed_at', Date.now())
    }
    emitPipelineEvent({
      event: 'broker_request_succeeded',
      correlation,
      timestamps: signal.pipeline_ts,
      outcome: 'success',
      path: useV2 ? 'fxsocket_v2' : 'fxsocket_v1',
      extra: {
        broker_ticket: result.ticket,
        symbol: sendArgs.symbol,
        operation: sendArgs.operation,
        leg: leg.idx + 1,
        total: totalCount,
        latency_ms: latencyMs,
        stops_fallback: stopsFallback || undefined,
      },
    })
    console.log(
      `[tradeExecutor] OrderSend ok signal=${signal.id} broker=${broker.id} ticket=${result.ticket} leg=${leg.idx + 1}/${totalCount}`
      + ` price=${sendArgs.price ?? 0} ${latencyMs}ms v2=${useV2}${stopsFallback ? ' stops_fallback' : ''}`,
    )

    const isBuy = !sendArgs.operation.toLowerCase().includes('sell')
    const entryPx = result.openPrice ?? sendArgs.price ?? null
    const openSl = stopsFallback ? (plannedSl > 0 ? plannedSl : null) : (result.stopLoss ?? sendArgs.stoploss ?? null)
    const openTp = stopsFallback ? (plannedTp > 0 ? plannedTp : null) : (result.takeProfit ?? sendArgs.takeprofit ?? null)
    const trailCols = trailingTradeRowSnapshot(
      manual,
      entryPx,
      openSl,
    )
    const autoBeCols = autoManagementTradeSnapshot(manual, entryPx, openSl)
    const tradeRowPayload = {
      user_id: signal.user_id,
      signal_id: signal.id,
      telegram_channel_id: signal.channel_id,
      broker_account_id: broker.id,
      metaapi_order_id: result.ticket != null ? String(result.ticket) : null,
      symbol: sendArgs.symbol,
      direction: isBuy ? 'buy' : 'sell',
      entry_price: entryPx,
      sl: openSl,
      tp: openTp,
      lot_size: result.lots ?? sendArgs.volume,
      status: sendArgs.operation.includes('Limit') || sendArgs.operation.includes('Stop') ? 'pending' : 'open',
      opened_at: new Date().toISOString(),
      cwe_close_price: leg.cweClosePrice ?? null,
      ...trailCols,
      ...autoBeCols,
    }
    const filledLeg: PostFillTradeLeg = {
      tradeRowId: null,
      ticket: result.ticket,
      symbol: sendArgs.symbol,
      direction: isBuy ? 'buy' : 'sell',
      entryPrice: entryPx,
      openSl: openSl != null ? Number(openSl) : null,
      openTp: openTp != null ? Number(openTp) : null,
    }

    const persistPostFillDb = async (tradeRowId: string | null) => {
      if (tradeRowId && leg.partialTps && leg.partialTps.length > 0) {
        const partialRows = leg.partialTps.map(p => ({
          trade_id: tradeRowId,
          signal_id: signal.id,
          user_id: signal.user_id,
          broker_account_id: broker.id,
          metaapi_account_id: uuid,
          symbol: sendArgs.symbol,
          is_buy: isBuy,
          tp_idx: p.tpIdx,
          trigger_price: p.triggerPrice,
          close_lots: p.closeLots,
          status: 'pending',
        }))
        const { error: partialErr } = await ctx.supabase
          .from('partial_tp_legs')
          .insert(partialRows)
        if (partialErr) {
          console.error(
            `[tradeExecutor] partial_tp_legs INSERT failed signal=${signal.id} broker=${broker.id} trade=${tradeRowId}: ${partialErr.message}`,
          )
        }
      }
      await ctx.supabase.from('trade_execution_logs').insert({
        user_id: signal.user_id,
        signal_id: signal.id,
        broker_account_id: broker.id,
        action: 'order_send',
        status: 'success',
        request_payload: {
          ...sendArgs,
          ...orderLogContext,
          ...(stopsFallback ? { stops_fallback: true } : {}),
        } as unknown as Record<string, unknown>,
        response_payload: {
          ticket: result.ticket,
          latency_ms: latencyMs,
          pipeline_ms: pipelineT0 != null ? Date.now() - pipelineT0 : undefined,
          leg: leg.idx + 1,
          total: totalCount,
        },
      })
    }

    if (liveEntryFast) {
      filledLegs.push(filledLeg)
      void (async () => {
        const tradeInsert = await ctx.supabase
          .from('trades')
          .insert(tradeRowPayload)
          .select('id')
          .maybeSingle()
        if (tradeInsert.error) {
          console.error(
            `[tradeExecutor] trades INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${tradeInsert.error.message}`,
          )
        }
        const tradeRowId = (tradeInsert.data as { id?: string } | null)?.id ?? null
        filledLeg.tradeRowId = tradeRowId
        await persistPostFillDb(tradeRowId)
        if (signal.pipeline_ts) {
          setPipelineTimestamp(signal.pipeline_ts, 'execution_state_persisted_at', Date.now())
        }
      })().catch(err => {
        console.error(
          `[tradeExecutor] post-fill persist failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}:`,
          err instanceof Error ? err.message : String(err),
        )
      })
    } else {
      const tradeInsert = await ctx.supabase
        .from('trades')
        .insert(tradeRowPayload)
        .select('id')
        .maybeSingle()
      if (tradeInsert.error) {
        console.error(
          `[tradeExecutor] trades INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${tradeInsert.error.message}`,
        )
      }
      filledLeg.tradeRowId = (tradeInsert.data as { id?: string } | null)?.id ?? null
      filledLegs.push(filledLeg)
      await persistPostFillDb(filledLeg.tradeRowId)
      if (signal.pipeline_ts) {
        setPipelineTimestamp(signal.pipeline_ts, 'execution_state_persisted_at', Date.now())
      }
    }
    return true
  }

  // All immediates fan out in parallel. Virtual pendings are already
  // persisted; the worker monitor + edge sweep will fire them on trigger.
  const sendResults = await Promise.allSettled(sendLegs.map(sendLeg))

  let materializedBrokerPendings = materializedVirtuals
  if (deferBrokerRangePendingMaterialize && brokerPendingMode && virtualPendings.length > 0 && api) {
    const fillAnchor = resolveBurstFillAnchor(
      filledLegs.map(l => l.entryPrice),
      plan.isBuy !== false,
    )
    let anchor = fillAnchor ?? prepAnchor
    let anchorSource: 'signal' | 'quote' | 'fill' | 'unknown' = fillAnchor != null
      ? 'fill'
      : prepAnchorSource
    if ((anchor == null || anchor <= 0) && strictEntryPrefetch) {
      const isBuyLeg = !op.toLowerCase().includes('sell')
      anchor = isBuyLeg ? strictEntryPrefetch.ask : strictEntryPrefetch.bid
      anchorSource = 'quote'
    }
    const runBrokerMaterialize = async () => {
      if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) {
        console.warn(
          `[tradeExecutor] deferred broker range pending: no anchor signal=${signal.id} broker=${broker.id}`,
        )
        return false
      }
      return materializeBrokerRangePendingLegs(
        ctx,
        prep,
        strictBrokerPlaced,
        { anchor, anchorSource },
      )
    }
    if (liveEntryFast) {
      void runBrokerMaterialize().catch(err => {
        console.error(
          `[tradeExecutor] deferred broker range pending failed signal=${signal.id} broker=${broker.id}:`,
          err,
        )
      })
      materializedBrokerPendings = true
    } else {
      materializedBrokerPendings = await runBrokerMaterialize()
    }
  }

  if (deferVirtualAnchor && virtualPendings.length > 0 && api && !brokerPendingMode) {
    const fillAnchor = resolveBurstFillAnchor(
      filledLegs.map(l => l.entryPrice),
      plan.isBuy !== false,
    )
    void ctx.deferredVirtualPendingMaterialize({
      signal,
      broker,
      uuid,
      api,
      symbol,
      virtualPendings,
      parsed,
      plan,
      params,
      strictEntryPrefetch,
      fillAnchor,
    }).catch(err => {
      console.error(
        `[tradeExecutor] deferred virtual pending failed signal=${signal.id} broker=${broker.id}:`,
        err,
      )
    })
  }
  if (liveEntryFast && filledLegs.length > 0) {
    const plannerCtx = params
      ? {
        point: params.point,
        digits: params.digits,
        minLot: params.minLot,
        lotStep: params.lotStep,
        contractSize: params.contractSize,
        stopsLevel: params.stopsLevel,
        freezeLevel: params.freezeLevel,
        defaultLot: Number(broker.default_lot_size ?? 0.01),
        lastBalance: broker.last_balance ?? null,
      }
      : null
    void applyPostFillFollowUp({
      supabase: ctx.supabase,
      api,
      uuid,
      signal,
      parsed,
      op,
      broker,
      channelKeywords,
      symbol,
      baseLot,
      params: plannerCtx,
      filledLegs,
      plannedBrokerTp: plan.orders[0]?.takeprofit ?? null,
      hasPartialTpSchedule: (plan.partialTps?.length ?? 0) > 0,
      hooks: {
        closeOppositeDirectionTrades: (s, p, _b, sym) =>
          ctx.closeOppositeDirectionTrades(s, p, broker, sym),
        tryParameterFollowUpMergeModifyOnly: async () => ({ handled: false }),
        tryMergeSignalIntoExistingOpenTrade: async () => ({ handled: false }),
      },
    }).catch(err => {
      console.error(`[tradeExecutor] postFillFollowUp failed signal=${signal.id}:`, err)
    })
  }
  const anyImmediateOpened = sendResults.some(
    r => r.status === 'fulfilled' && r.value === true,
  )
  const parsedTpCount = (parsed.tp ?? []).filter(
    (t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0,
  ).length
  const tpLotBuckets = (manual.tp_lots ?? []).filter(
    r => r?.enabled !== false && Number(r.percent) > 0,
  ).length
  const needsPerLegTpSync = parsedTpCount >= 2 || tpLotBuckets >= 2
  if (syncMultiLegTps
    && anyImmediateOpened
    && sendLegs.length > 1
    && needsPerLegTpSync
  ) {
    const syncArgs = {
      signal,
      parsed,
      broker,
      plan,
      symbol,
      uuid,
      params,
      manual,
      direction: op.toLowerCase().includes('sell') ? 'sell' as const : 'buy' as const,
    }
    if (liveEntryFast) {
      void ctx.syncMultiBasketLegTakeProfits(syncArgs).catch(err => {
        console.error(`[tradeExecutor] syncMultiBasketLegTakeProfits failed signal=${signal.id}:`, err)
      })
    } else {
      await ctx.syncMultiBasketLegTakeProfits(syncArgs)
    }
  }
  if (virtualPendings.length > 0 && !anyImmediateOpened && !strictDeferred) {
    const { deleteRangePendingLegsForBasket } = await import('../rangePendingLegDelete')
    const rowsCancelled = await deleteRangePendingLegsForBasket(
      ctx.supabase,
      { signalId: signal.id, brokerAccountId: broker.id },
      'orphan_no_immediate_fills',
    )
    if (rowsCancelled > 0) {
      console.warn(
        `[tradeExecutor] stripped range pendings (zero successful immediates) signal=${signal.id} broker=${broker.id} rows=${rowsCancelled}`,
      )
    } else {
      console.warn(
        `[tradeExecutor] no range pendings stripped signal=${signal.id} broker=${broker.id}`,
      )
    }
  }
  const openedOrMerged = anyImmediateOpened || materializedBrokerPendings || strictBrokerPlaced
  return {
    openedOrMerged,
    channelDelayMs,
    channelDelaySkipped,
    ...(!openedOrMerged
      ? { failureReason: lastSendError ?? SKIP_REASON_ENTRY_NOT_OPENED }
      : {}),
  }
}
