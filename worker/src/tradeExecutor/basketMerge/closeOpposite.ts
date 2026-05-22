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

import { cancelRangePendingLegsForScopes } from './pendingCancel'

export async function closeOppositeDirectionTrades(ctx: TradeExecutorContext, 
    signal: SignalRow,
    parsed: ParsedSignal,
    broker: BrokerRow,
    symbol: string,
  ): Promise<void> {
    if (!hasMetatraderApiConfigured()) return
    const manual = (broker.manual_settings ?? {}) as ManualSettings
    if (manual.close_on_opposite_signal !== true) return
    if (isOppositeSignalCloseBlocked(
      normalizeChannelMessageFiltersMap(broker.channel_message_filters),
      signal.channel_id,
    )) return
    const a = String(parsed.action ?? '').toLowerCase()
    if (a !== 'buy' && a !== 'sell') return
    const channelBuy = a === 'buy'
    const oppDir = channelBuy ? 'sell' : 'buy'
    const uuid = broker.metaapi_account_id!
    const api = ctx.apiFor(broker)
    if (!api) return
    const { data: opposites } = await ctx.supabase
      .from('trades')
      .select('id,signal_id,broker_account_id,metaapi_order_id,symbol,direction,lot_size')
      .eq('broker_account_id', broker.id)
      .eq('symbol', symbol)
      .eq('status', 'open')
      .eq('direction', oppDir)
    const rows = opposites ?? []
    if (!rows.length) return

    const scopes: RangePendingCancelScope[] = []
    for (const t of rows) {
      const ticket = Number(t.metaapi_order_id)
      if (!Number.isFinite(ticket) || ticket <= 0) continue
      try {
        await api.orderClose(uuid, { ticket })
        await ctx.supabase
          .from('trades')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('id', t.id)
        scopes.push({ signalId: t.signal_id, brokerAccountId: broker.id, symbol })
        try {
          await ctx.supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: broker.id,
            action: 'opposite_signal_close',
            status: 'success',
            request_payload: {
              closed_trade_id: t.id,
              ticket,
              direction: t.direction,
              channel_action: a,
              symbol,
            } as unknown as Record<string, unknown>,
          })
        } catch {
          // logging best-effort
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(
          `[tradeExecutor] opposite_signal_close failed trade=${t.id} ticket=${ticket} broker=${broker.id}: ${msg}`,
        )
        try {
          await ctx.supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: broker.id,
            action: 'opposite_signal_close',
            status: 'failed',
            request_payload: { closed_trade_id: t.id, ticket, symbol } as unknown as Record<string, unknown>,
            error_message: msg,
          })
        } catch {
          // best-effort
        }
      }
    }
    if (scopes.length && !isPendingCancelBlocked(
      normalizeChannelMessageFiltersMap(broker.channel_message_filters),
      signal.channel_id,
    )) {
      await cancelRangePendingLegsForScopes(ctx, signal.user_id, signal.id, scopes, 'opposite_signal_close')
    }
  }
