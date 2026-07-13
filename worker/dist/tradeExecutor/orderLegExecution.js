"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendImmediateLegs = sendImmediateLegs;
const fxsocketClient_1 = require("../fxsocketClient");
const brokerConnectError_1 = require("../brokerConnectError");
const autoManagement_1 = require("../autoManagement");
const channelActiveTradeParams_1 = require("../channelActiveTradeParams");
const orderModifySafe_1 = require("../orderModifySafe");
const trailingStop_1 = require("../trailingStop");
const postFillFollowUp_1 = require("../postFillFollowUp");
const helpers_1 = require("./helpers");
const executionMode_1 = require("../engine/executionMode");
const fxClient_1 = require("../engine/fxClient");
const manualPlanner_1 = require("../manualPlanner");
const materializeBrokerRangePendingLegs_1 = require("./materializeBrokerRangePendingLegs");
async function sendImmediateLegs(input) {
    const { ctx, signal, parsed, broker, manual, api, uuid, symbol, requestedSymbol, mapping, params, legs, liveEntryFast, pipelineT0, strictEntryPrefetch, channelDelayMs, channelDelaySkipped, deferVirtualAnchor, deferBrokerRangePendingMaterialize, brokerPendingMode, prepAnchor, prepAnchorSource, virtualPendings, plan, materializedVirtuals, strictBrokerPlaced, strictDeferred, op, channelKeywords, baseLot, syncMultiLegTps, prep, } = input;
    if (legs.length === 0) {
        // No immediates — virtual range ladder and/or broker strict-entry pending.
        return (materializedVirtuals || strictBrokerPlaced)
            ? { openedOrMerged: true, channelDelayMs, channelDelaySkipped }
            : {
                channelDelayMs,
                channelDelaySkipped,
                failureReason: manualPlanner_1.SKIP_REASON_ENTRY_NOT_OPENED,
            };
    }
    if (manual.trade_style !== 'multi' && legs.length > 1) {
        console.error(`[tradeExecutor] single trade_style aborting ${legs.length} legs signal=${signal.id} broker=${broker.id}`);
    }
    const sendLegs = manual.trade_style !== 'multi' && legs.length > 1 ? legs.slice(0, 1) : legs;
    const totalCount = sendLegs.length;
    const orderLogContext = {
        signal_symbol: parsed.symbol ?? null,
        trade_symbol: requestedSymbol,
    };
    if (mapping.whitelist.length > 0) {
        orderLogContext.allowed_symbols = mapping.whitelist;
    }
    const filledLegs = [];
    let lastSendError = null;
    // v2 entries fire PROTECTED-at-send through the strict fxClient (bounded timeout,
    // strict retcode, no blind 3x retries) instead of the old client. One pre-burst
    // OpenedOrders snapshot powers ambiguous-send adoption so retries never duplicate.
    const useV2 = (0, executionMode_1.isV2)({ brokerAccountId: broker.id, userId: signal.user_id });
    const v2Platform = (0, fxClient_1.toMtPlatform)(broker.platform);
    const v2Snapshot = useV2
        ? await (0, fxClient_1.getFxClient)().openedOrders(uuid, v2Platform).catch(() => [])
        : [];
    const sendLeg = async (leg) => {
        let args = leg.args;
        const isBuyLeg = (0, helpers_1.isBuySideOp)(String(args.operation));
        const isMarket = args.operation === 'Buy' || args.operation === 'Sell';
        if (isMarket && (!args.price || args.price <= 0) && (strictEntryPrefetch || api)) {
            try {
                const q = strictEntryPrefetch ?? await api.quote(uuid, symbol);
                args = { ...args, price: isBuyLeg ? q.ask : q.bid };
            }
            catch {
                /* clamp may no-op without ref */
            }
        }
        const refPx = Number(args.price) || 0;
        if (refPx > 0) {
            const stripped = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
                stoploss: Number(args.stoploss) || 0,
                takeprofit: Number(args.takeprofit) || 0,
                referencePrice: refPx,
                isBuy: isBuyLeg,
            });
            if (stripped.stripped.length > 0) {
                console.warn(`[tradeExecutor] stripped invalid stops signal=${signal.id} broker=${broker.id}`
                    + ` ref=${refPx} isBuy=${isBuyLeg}: ${stripped.stripped.join(', ')}`);
                args = { ...args, stoploss: stripped.stoploss, takeprofit: stripped.takeprofit };
            }
        }
        // Final SL/TP clamp using the actual market/entry price as the reference.
        const clamped = (0, helpers_1.clampOrderStops)(args, params);
        if (clamped.adjustments.length > 0) {
            console.warn(`[tradeExecutor] stops clamped signal=${signal.id} broker=${broker.id} symbol=${args.symbol} op=${args.operation}: ${clamped.adjustments.join(', ')}`);
        }
        args = clamped.args;
        const plannedSl = Number(args.stoploss) || 0;
        const plannedTp = Number(args.takeprofit) || 0;
        const t0 = Date.now();
        if (liveEntryFast && signal.pipeline_ts && signal.pipeline_ts.t_first_broker_send == null) {
            signal.pipeline_ts.t_first_broker_send = t0;
        }
        let sendArgs = args;
        let stopsFallback = false;
        let result = null;
        let lastAttemptError = '';
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (useV2) {
                    const r = await (0, fxClient_1.getFxClient)().orderSend(uuid, v2Platform, {
                        symbol: sendArgs.symbol,
                        operation: sendArgs.operation,
                        volume: sendArgs.volume,
                        price: Number(sendArgs.price) > 0 ? Number(sendArgs.price) : undefined,
                        stopLoss: Number(sendArgs.stoploss) > 0 ? Number(sendArgs.stoploss) : undefined,
                        takeProfit: Number(sendArgs.takeprofit) > 0 ? Number(sendArgs.takeprofit) : undefined,
                        comment: sendArgs.comment,
                        slippage: sendArgs.slippage,
                        expertId: sendArgs.expertID,
                    }, { anchorSignalId: signal.id, legIndex: leg.idx, preSnapshot: v2Snapshot });
                    if (!r.ok || !r.ticket)
                        throw new Error(r.message || `v2 order_send rejected (${r.retcodeName})`);
                    result = {
                        ticket: r.ticket,
                        openPrice: r.price,
                        stopLoss: Number(sendArgs.stoploss) > 0 ? Number(sendArgs.stoploss) : null,
                        takeProfit: Number(sendArgs.takeprofit) > 0 ? Number(sendArgs.takeprofit) : null,
                        lots: r.volume ?? sendArgs.volume,
                    };
                }
                else {
                    const raw = await api.orderSend(uuid, sendArgs);
                    result = {
                        ticket: raw.ticket,
                        openPrice: raw.openPrice ?? null,
                        stopLoss: raw.stopLoss ?? null,
                        takeProfit: raw.takeProfit ?? null,
                        lots: raw.lots ?? null,
                    };
                }
                break;
            }
            catch (err) {
                lastAttemptError = err instanceof Error ? err.message : String(err);
                const hasStops = (Number(sendArgs.stoploss) || 0) > 0 || (Number(sendArgs.takeprofit) || 0) > 0;
                if (attempt === 0 && (0, orderModifySafe_1.isInvalidStopsError)(lastAttemptError) && hasStops) {
                    console.warn(`[tradeExecutor] retry without stops signal=${signal.id} broker=${broker.id} leg=${leg.idx + 1}/${totalCount}`
                        + ` reason="${lastAttemptError}" (sl=${sendArgs.stoploss} tp=${sendArgs.takeprofit})`);
                    sendArgs = { ...sendArgs, stoploss: 0, takeprofit: 0 };
                    stopsFallback = true;
                    continue;
                }
                lastSendError = lastAttemptError;
                if ((0, fxsocketClient_1.isBrokerDisconnectedMessage)(lastAttemptError) && !(0, brokerConnectError_1.isMtBridgeGlitchMessage)(lastAttemptError)) {
                    await ctx.markBrokerSessionDown(broker, uuid, lastAttemptError);
                }
                console.error(`[tradeExecutor] OrderSend failed signal=${signal.id} broker=${broker.id} leg=${leg.idx + 1}/${totalCount} op=${sendArgs.operation} price=${sendArgs.price ?? 0}:`, lastAttemptError);
                await ctx.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'order_send',
                    status: 'failed',
                    request_payload: { ...sendArgs, ...orderLogContext },
                    error_message: lastAttemptError,
                });
                return false;
            }
        }
        if (!result)
            return false;
        const latencyMs = Date.now() - t0;
        if (liveEntryFast && signal.pipeline_ts) {
            signal.pipeline_ts.t_last_broker_send = Date.now();
        }
        console.log(`[tradeExecutor] OrderSend ok signal=${signal.id} broker=${broker.id} ticket=${result.ticket} leg=${leg.idx + 1}/${totalCount}`
            + ` price=${sendArgs.price ?? 0} ${latencyMs}ms v2=${useV2}${stopsFallback ? ' stops_fallback' : ''}`);
        const isBuy = !sendArgs.operation.toLowerCase().includes('sell');
        const entryPx = result.openPrice ?? sendArgs.price ?? null;
        const openSl = stopsFallback ? (plannedSl > 0 ? plannedSl : null) : (result.stopLoss ?? sendArgs.stoploss ?? null);
        const openTp = stopsFallback ? (plannedTp > 0 ? plannedTp : null) : (result.takeProfit ?? sendArgs.takeprofit ?? null);
        const trailCols = (0, trailingStop_1.trailingTradeRowSnapshot)(manual, entryPx, openSl);
        const autoBeCols = (0, autoManagement_1.autoManagementTradeSnapshot)(manual, entryPx, openSl);
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
        };
        const filledLeg = {
            tradeRowId: null,
            ticket: result.ticket,
            symbol: sendArgs.symbol,
            direction: isBuy ? 'buy' : 'sell',
            entryPrice: entryPx,
            openSl: openSl != null ? Number(openSl) : null,
            openTp: openTp != null ? Number(openTp) : null,
        };
        const persistPostFillDb = async (tradeRowId) => {
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
                }));
                const { error: partialErr } = await ctx.supabase
                    .from('partial_tp_legs')
                    .insert(partialRows);
                if (partialErr) {
                    console.error(`[tradeExecutor] partial_tp_legs INSERT failed signal=${signal.id} broker=${broker.id} trade=${tradeRowId}: ${partialErr.message}`);
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
                },
                response_payload: {
                    ticket: result.ticket,
                    latency_ms: latencyMs,
                    pipeline_ms: pipelineT0 != null ? Date.now() - pipelineT0 : undefined,
                    leg: leg.idx + 1,
                    total: totalCount,
                },
            });
        };
        if (liveEntryFast) {
            filledLegs.push(filledLeg);
            void (async () => {
                const tradeInsert = await ctx.supabase
                    .from('trades')
                    .insert(tradeRowPayload)
                    .select('id')
                    .maybeSingle();
                if (tradeInsert.error) {
                    console.error(`[tradeExecutor] trades INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${tradeInsert.error.message}`);
                }
                const tradeRowId = tradeInsert.data?.id ?? null;
                filledLeg.tradeRowId = tradeRowId;
                await persistPostFillDb(tradeRowId);
            })().catch(err => {
                console.error(`[tradeExecutor] post-fill persist failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}:`, err instanceof Error ? err.message : String(err));
            });
        }
        else {
            const tradeInsert = await ctx.supabase
                .from('trades')
                .insert(tradeRowPayload)
                .select('id')
                .maybeSingle();
            if (tradeInsert.error) {
                console.error(`[tradeExecutor] trades INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${tradeInsert.error.message}`);
            }
            filledLeg.tradeRowId = tradeInsert.data?.id ?? null;
            filledLegs.push(filledLeg);
            await persistPostFillDb(filledLeg.tradeRowId);
        }
        return true;
    };
    // All immediates fan out in parallel. Virtual pendings are already
    // persisted; the worker monitor + edge sweep will fire them on trigger.
    const sendResults = await Promise.allSettled(sendLegs.map(sendLeg));
    let materializedBrokerPendings = materializedVirtuals;
    if (deferBrokerRangePendingMaterialize && brokerPendingMode && virtualPendings.length > 0 && api) {
        const fillAnchor = (0, helpers_1.resolveBurstFillAnchor)(filledLegs.map(l => l.entryPrice), plan.isBuy !== false);
        let anchor = fillAnchor ?? prepAnchor;
        let anchorSource = fillAnchor != null
            ? 'fill'
            : prepAnchorSource;
        if ((anchor == null || anchor <= 0) && strictEntryPrefetch) {
            const isBuyLeg = !op.toLowerCase().includes('sell');
            anchor = isBuyLeg ? strictEntryPrefetch.ask : strictEntryPrefetch.bid;
            anchorSource = 'quote';
        }
        const runBrokerMaterialize = async () => {
            if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) {
                console.warn(`[tradeExecutor] deferred broker range pending: no anchor signal=${signal.id} broker=${broker.id}`);
                return false;
            }
            return (0, materializeBrokerRangePendingLegs_1.materializeBrokerRangePendingLegs)(ctx, prep, strictBrokerPlaced, { anchor, anchorSource });
        };
        if (liveEntryFast) {
            void runBrokerMaterialize().catch(err => {
                console.error(`[tradeExecutor] deferred broker range pending failed signal=${signal.id} broker=${broker.id}:`, err);
            });
            materializedBrokerPendings = true;
        }
        else {
            materializedBrokerPendings = await runBrokerMaterialize();
        }
    }
    if (deferVirtualAnchor && virtualPendings.length > 0 && api && !brokerPendingMode) {
        const fillAnchor = (0, helpers_1.resolveBurstFillAnchor)(filledLegs.map(l => l.entryPrice), plan.isBuy !== false);
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
            console.error(`[tradeExecutor] deferred virtual pending failed signal=${signal.id} broker=${broker.id}:`, err);
        });
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
            : null;
        void (0, postFillFollowUp_1.applyPostFillFollowUp)({
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
                closeOppositeDirectionTrades: (s, p, _b, sym) => ctx.closeOppositeDirectionTrades(s, p, broker, sym),
                tryParameterFollowUpMergeModifyOnly: async () => ({ handled: false }),
                tryMergeSignalIntoExistingOpenTrade: async () => ({ handled: false }),
            },
        }).catch(err => {
            console.error(`[tradeExecutor] postFillFollowUp failed signal=${signal.id}:`, err);
        });
    }
    const anyImmediateOpened = sendResults.some(r => r.status === 'fulfilled' && r.value === true);
    const parsedTpCount = (parsed.tp ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t) && t > 0).length;
    const tpLotBuckets = (manual.tp_lots ?? []).filter(r => r?.enabled !== false && Number(r.percent) > 0).length;
    const needsPerLegTpSync = parsedTpCount >= 2 || tpLotBuckets >= 2;
    if (syncMultiLegTps
        && anyImmediateOpened
        && sendLegs.length > 1
        && needsPerLegTpSync) {
        const syncArgs = {
            signal,
            parsed,
            broker,
            plan,
            symbol,
            uuid,
            params,
            manual,
            direction: op.toLowerCase().includes('sell') ? 'sell' : 'buy',
        };
        if (liveEntryFast) {
            void ctx.syncMultiBasketLegTakeProfits(syncArgs).catch(err => {
                console.error(`[tradeExecutor] syncMultiBasketLegTakeProfits failed signal=${signal.id}:`, err);
            });
        }
        else {
            await ctx.syncMultiBasketLegTakeProfits(syncArgs);
        }
    }
    if (virtualPendings.length > 0 && !anyImmediateOpened && !strictDeferred) {
        const { deleteRangePendingLegsForBasket } = await Promise.resolve().then(() => __importStar(require('../rangePendingLegDelete')));
        const rowsCancelled = await deleteRangePendingLegsForBasket(ctx.supabase, { signalId: signal.id, brokerAccountId: broker.id }, 'orphan_no_immediate_fills');
        if (rowsCancelled > 0) {
            console.warn(`[tradeExecutor] stripped range pendings (zero successful immediates) signal=${signal.id} broker=${broker.id} rows=${rowsCancelled}`);
        }
        else {
            console.warn(`[tradeExecutor] no range pendings stripped signal=${signal.id} broker=${broker.id}`);
        }
    }
    const openedOrMerged = anyImmediateOpened || materializedBrokerPendings || strictBrokerPlaced;
    return {
        openedOrMerged,
        channelDelayMs,
        channelDelaySkipped,
        ...(!openedOrMerged
            ? { failureReason: lastSendError ?? manualPlanner_1.SKIP_REASON_ENTRY_NOT_OPENED }
            : {}),
    };
}
