import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import {
  getMetatraderApi,
  hasMetatraderApiConfigured,
  isBrokerDisconnectedMessage,
  MT_SESSION_EXPIRED_HINT,
  mtPlatformFrom,
  MetatraderApiClient,
  MtOperation,
  normalizeSymbolParams,
  OrderSendArgs,
  SymbolParams,
} from '../../metatraderapi'
import {
  clampPendingExpiryHours,
  computeCwOverrideTp,
  parsedHasExplicitEntryAnchor,
  planManualOrders,
  resolvedParsedEntryPrice,
  resolvedParsedEntryZone,
  signalEntryPriceStrictEnabled,
  SKIP_REASON_SIGNAL_ENTRY_REQUIRED,
  strictSignalEntryQuoteAllowsImmediate,
  lastPositiveParsedTpPrice,
  type ChannelKeywords,
  type ManualSettings,
  type ParsedSignal as PlannerParsedSignal,
  type PlannerPartialTp,
  type PlannerResult,
  type VirtualPendingLeg,
} from '../../manualPlanner'
import { normalizeManualSettingsForExecution } from '../../manualPlanning/normalizeManualSettings'
import { findActiveNewsBlackout } from '../../newsTrading/blackout'
import { getCalendarEventsCached } from '../../newsTrading/calendarProvider'
import { isNewsTradingEnabled } from '../../newsTrading/settings'
import { autoManagementTradeSnapshot } from '../../autoManagement'
import {
  referencePriceForDirection,
  cweInstructionGroupKey,
  parseCweInstructionGroupKey,
  selectTradesForCweInstruction,
} from '../../closeWorseEntries'
import {
  dispatchPriorityForAction,
  isEntryAction,
  isManagementAction,
  parsedAction,
  signalMatchesExecutorMode,
} from '../../tradeSignalActions'
import { workerConfig, userBelongsToShard } from '../../workerConfig'
import { writeBrokerConnectionStatus } from '../../brokerConnectionStatus'
import {
  applyShardToQuery,
  hasWorkOnShard,
  monitorActiveIntervalMs,
  monitorIdleIntervalMs,
  startMonitorLoop,
  type MonitorLoopHandle,
} from '../../monitorIdleGate'
import {
  isChannelManagementBlocked,
  isOppositeSignalCloseBlocked,
  isPendingCancelBlocked,
  normalizeChannelMessageFiltersMap,
  type ChannelMessageFiltersMap,
} from '../../channelMessageFilters'
import { signalPipPrice } from '../../signalPip'
import { trailingTradeRowSnapshot } from '../../trailingStop'
import { isPostgresDuplicateKeyError } from '../../rangePendingLegPersist'
import { cancelSignalEntryRowAtBroker, type SignalEntryPendingRow } from '../../signalEntryPendingHelpers'
import {
  computeBasketMergeLinkContext,
  type BasketMergeLinkContext,
  MERGE_IMPLICIT_CHANNEL_BUNDLE_MS,
} from '../../signalMergeLink'
import type { UserSessionManager } from '../../sessionManager'
import {
  buildPerLegStopTargets,
  legacyMergeLinkingEnabled,
  mergePlanImmediateOrders,
  resolveLatestOpenBasketAnchor,
  shouldRouteAsBasketParameterRefresh,
  type MergeModifySummary,
} from '../../multiTradeMerge'
import { symbolsCompatibleForBasket } from '../../basketModFollowUp'
import {
  classifyGhostBasketLegs,
  closeStaleOpenTrades,
  fetchOpenBrokerTickets,
  fetchOpenBrokerTicketsStrict,
  GHOST_BASKET_CLOSED_USER_MESSAGE,
  markBasketReconcileDone,
  markBasketReconcileDoneForAnchor,
  runBasketLegModifies,
  upsertBasketReconcileJob,
  type BasketOpenLeg,
  type BasketSymbolParams,
} from '../../basketSlTpReconcile'
import { syncRangePendingLadderOnBasketRefresh } from '../../rangePendingLadderSync'
import { loadExistingRangeStepIndices } from '../../rangePendingFireGuard'
import { channelMatchesBrokerSignal } from '../../brokerChannelFilter'
import { takeProfitForLegIndex } from '../../manualPlanning/tpBucketDistribution'
import {
  explicitMgmtSymbol,
  isReplyScopedManagement,
  loadOpenTradesForManagement,
  resolveChannelModifyTargets,
  type MgmtTradeRow,
} from '../../managementScope'
import {
  applyChannelParamsToVirtualPendingList,
  estimateBasketTotalPlannedLegs,
  loadChannelActiveTradeParamsForSymbol,
  mergeParsedWithChannelParams,
  reapplyChannelParamsToPendingLegs,
  parsedSignalHasExplicitStops,
  shouldMergeChannelParamsForEntry,
  stripInvalidStopsForSide,
  symbolsForChannelParamsPersist,
  upsertChannelActiveTradeParams,
  type ChannelActiveTradeParams,
} from '../../channelActiveTradeParams'
import {
  loadRangePendingLegsInMgmtScope,
  pendingLegsToCancelScopes,
  updateRangePendingLegsForManagement,
} from '../../managementPendingLegs'
import { parsePipelineTimestamps, pipelineSummaryPayload, type PipelineTimestamps } from '../../pipelineTimestamps'
import {
  buildTscopierCommentPrefix,
  resolveChannelLabelForComment,
  sanitizeChannelCommentSlug,
} from '../../tradeComment'
import { applyPostFillFollowUp, type PostFillTradeLeg } from '../../postFillFollowUp'
import { isBenignOrderModifyError } from '../../orderModifyBenign'
import { invalidateChannelParseCache } from '../../channelKeywordsCache'
import type { TradeExecutorContext } from '../context'
import type {
  BrokerRow,
  MergeOutcome,
  ParsedSignal,
  RangePendingCancelScope,
  SignalRow,
  SymbolCacheEntry,
} from '../types'
import { computeCweTp, roundLot, triggerPriceFor } from '../helpers'


export async function syncMultiBasketLegTakeProfits(ctx: TradeExecutorContext, args: {
    signal: SignalRow
    parsed: ParsedSignal
    broker: BrokerRow
    plan: PlannerResult
    symbol: string
    uuid: string
    params: SymbolCacheEntry | null
    manual: ManualSettings
    direction: 'buy' | 'sell'
  }): Promise<void> {
    const { signal, parsed, broker, plan, symbol, uuid, params, manual, direction } = args
    const api = ctx.apiFor(broker)
    if (!api) return

    await new Promise(r => setTimeout(r, 250))

    const { data: familyRows, error } = await ctx.supabase
      .from('trades')
      .select('id,signal_id,metaapi_order_id,opened_at,lot_size,sl,tp,entry_price,direction,symbol')
      .eq('broker_account_id', broker.id)
      .eq('signal_id', signal.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: true })
      .limit(500)
    if (error || !(familyRows ?? []).length) return

    const familyTrades = (familyRows ?? []) as BasketOpenLeg[]
    const immediateLegCount = mergePlanImmediateOrders(plan).length
    const totalPlannedLegCount =
      immediateLegCount + (plan.virtualPendings?.length ?? 0)
    const perLegTargets = buildPerLegStopTargets({
      plan,
      parsed,
      openLegCount: familyTrades.length,
      totalPlannedLegCount,
      immediateLegCount,
      tpLots: manual.tp_lots,
    })
    if (!perLegTargets.length) return

    let openedTickets: Set<number> | null = null
    try {
      openedTickets = await fetchOpenBrokerTickets(api, uuid)
    } catch { /* optional */ }

    const basketParams: BasketSymbolParams | null = params
      ? {
          digits: params.digits,
          point: params.point,
          minLot: params.minLot,
          lotStep: params.lotStep,
          contractSize: params.contractSize,
          stopsLevel: params.stopsLevel,
          freezeLevel: params.freezeLevel,
        }
      : null

    try {
      await runBasketLegModifies({
        supabase: ctx.supabase,
        api,
        uuid,
        symbol,
        direction,
        baseLot: Number(broker.default_lot_size ?? 0.01),
        params: basketParams,
        signalId: signal.id,
        userId: signal.user_id,
        brokerAccountId: broker.id,
        familyTrades,
        perLegTargets,
        signalTps: (parsed.tp ?? []).filter(
          (t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0,
        ),
        tpLots: manual.tp_lots,
        nImmCwe: 0,
        overrideTp: null,
        strictEntryPrefetch: null,
        openedTickets,
        skipAlreadySynced: true,
      })
    } catch (err) {
      console.warn(
        `[tradeExecutor] multi TP sync failed signal=${signal.id} broker=${broker.id}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
