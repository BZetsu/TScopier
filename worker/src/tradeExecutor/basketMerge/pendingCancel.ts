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
import { deleteRangePendingLegsForBasket } from '../../rangePendingLegDelete'
import { computeCweTp, roundLot, triggerPriceFor } from '../helpers'


export async function cancelSignalEntryBrokerRowsForScope(ctx: TradeExecutorContext, 
    scope: RangePendingCancelScope,
    userId: string,
    logSignalId: string,
    reason: string,
  ): Promise<void> {
    const { data: seRows, error } = await ctx.supabase
      .from('signal_entry_pending_orders')
      .select('id,signal_id,user_id,broker_account_id,metaapi_account_id,symbol,trade_id,broker_ticket,is_buy')
      .eq('signal_id', scope.signalId)
      .eq('broker_account_id', scope.brokerAccountId)
      .eq('status', 'broker_pending')
    if (error) {
      console.warn(
        `[tradeExecutor] signal_entry_pending_orders cancel select failed signal=${scope.signalId} broker=${scope.brokerAccountId}: ${error.message}`,
      )
      return
    }
    for (const r of (seRows ?? []) as SignalEntryPendingRow[]) {
      const api = ctx.apiForUuid(r.metaapi_account_id)
      if (api) {
        await cancelSignalEntryRowAtBroker(ctx.supabase, api, r, reason)
      } else {
        await ctx.supabase
          .from('signal_entry_pending_orders')
          .update({
            cancel_requested_at: new Date().toISOString(),
            cancel_reason: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.id)
          .eq('status', 'broker_pending')
      }
    }
  }

export async function cancelRangePendingLegsForScopes(ctx: TradeExecutorContext, 
    userId: string,
    logSignalId: string,
    scopes: RangePendingCancelScope[],
    reason: string,
  ): Promise<void> {
    const uniq = new Map<string, RangePendingCancelScope>()
    for (const s of scopes) {
      uniq.set(`${s.signalId}|${s.brokerAccountId}`, s)
    }
    await Promise.allSettled(
      [...uniq.values()].map(async scope => {
        try {
          const rowsCancelled = await deleteRangePendingLegsForBasket(
            ctx.supabase,
            { signalId: scope.signalId, brokerAccountId: scope.brokerAccountId },
            reason,
          )
          if (rowsCancelled > 0) {
          try {
            await ctx.supabase.from('trade_execution_logs').insert({
              user_id: userId,
              signal_id: logSignalId,
              broker_account_id: scope.brokerAccountId,
              action: 'virtual_pending_cancelled',
              status: 'success',
              request_payload: {
                reason,
                parent_signal_id: scope.signalId,
                rows: rowsCancelled,
              } as unknown as Record<string, unknown>,
            })
          } catch {
            // Logging failure is non-fatal.
          }
          }
          await ctx.cancelSignalEntryBrokerRowsForScope(scope, userId, logSignalId, reason)
        } catch {
          // best-effort
        }
      }),
    )
  }
