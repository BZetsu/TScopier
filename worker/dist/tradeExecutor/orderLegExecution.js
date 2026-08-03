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
const pipelineTimestamps_1 = require("../pipelineTimestamps");
const ensureSignalRow_1 = require("../ensureSignalRow");
const sentry_1 = require("../observability/sentry");
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
        let sendArgs = args;
        const plannedSl = Number(args.stoploss) || 0;
        const plannedTp = Number(args.takeprofit) || 0;
        const t0 = Date.now();
        if (liveEntryFast && signal.pipeline_ts && signal.pipeline_ts.t_first_broker_send == null) {
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_request_started_at', t0);
        }
        else if (signal.pipeline_ts && signal.pipeline_ts.broker_request_started_at == null) {
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_request_started_at', t0);
        }
        let stopsFallback = false;
        let result = null;
        let lastAttemptError;
        let correlation = (0, pipelineTimestamps_1.buildPipelineCorrelation)({
            userId: signal.user_id,
            signalId: signal.id,
            channelId: signal.channel_id,
            telegramMessageId: signal.telegram_message_id,
            brokerAccountId: broker.id,
            executionAttemptId: `${signal.id}:${broker.id}:${leg.idx}:1`,
            brokerRequestId: `${signal.id}:${broker.id}:${leg.idx}`,
            dispatchSource: signal.dispatch_source,
        });
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const attemptNo = attempt + 1;
                correlation = (0, pipelineTimestamps_1.buildPipelineCorrelation)({
                    userId: signal.user_id,
                    signalId: signal.id,
                    channelId: signal.channel_id,
                    telegramMessageId: signal.telegram_message_id,
                    brokerAccountId: broker.id,
                    executionAttemptId: `${signal.id}:${broker.id}:${leg.idx}:${attemptNo}`,
                    brokerRequestId: `${signal.id}:${broker.id}:${leg.idx}`,
                    dispatchSource: signal.dispatch_source,
                });
                if (useV2) {
                    const sendPromise = (0, fxClient_1.getFxClient)().orderSend(uuid, v2Platform, {
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
                    (0, pipelineTimestamps_1.emitPipelineEvent)({
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
                    }, { deferLog: true });
                    const r = await sendPromise;
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
                    const sendPromise = api.orderSend(uuid, sendArgs);
                    (0, pipelineTimestamps_1.emitPipelineEvent)({
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
                    }, { deferLog: true });
                    const raw = await sendPromise;
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
                (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts ?? (signal.pipeline_ts = {}), 'broker_response_received_at', Date.now());
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
                if ((0, fxsocketClient_1.isOrderOpTimedOutMessage)(lastAttemptError)) {
                    (0, sentry_1.captureWorkerError)(err instanceof Error ? err : new Error(lastAttemptError), {
                        subsystem: 'broker',
                        operation: 'order_send_ambiguous',
                        errorCode: 'ORDER_SEND_TIMEOUT',
                        fingerprint: ['broker', 'ORDER_SEND_TIMEOUT', useV2 ? 'fxsocket_v2' : 'fxsocket_v1'],
                        context: {
                            user_id: signal.user_id,
                            signal_id: signal.id,
                            channel_id: signal.channel_id,
                            telegram_message_id: signal.telegram_message_id,
                            broker_account_id: broker.id,
                            execution_attempt_id: correlation.execution_attempt_id,
                            broker_request_id: correlation.broker_request_id,
                            dispatch_source: signal.dispatch_source,
                            stage: 'order_send',
                            retry_attempt: attempt + 1,
                            extra: {
                                path: useV2 ? 'fxsocket_v2' : 'fxsocket_v1',
                                operation: sendArgs.operation,
                                symbol: sendArgs.symbol,
                                leg: leg.idx + 1,
                                total: totalCount,
                            },
                        },
                    });
                }
                await ctx.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'order_send',
                    status: 'failed',
                    request_payload: { ...sendArgs, ...orderLogContext },
                    error_message: lastAttemptError,
                });
                (0, pipelineTimestamps_1.emitPipelineEvent)({
                    event: (0, fxsocketClient_1.isOrderOpTimedOutMessage)(lastAttemptError) ? 'execution_ambiguous' : 'broker_request_failed',
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
                });
                return false;
            }
        }
        if (!result)
            return false;
        const latencyMs = Date.now() - t0;
        if (liveEntryFast && signal.pipeline_ts) {
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_response_received_at', Date.now());
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_execution_confirmed_at', Date.now());
        }
        else if (signal.pipeline_ts) {
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_response_received_at', Date.now());
            (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'broker_execution_confirmed_at', Date.now());
        }
        (0, pipelineTimestamps_1.emitPipelineEvent)({
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
        });
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
                    (0, sentry_1.captureWorkerWarning)(partialErr, {
                        subsystem: 'persistence',
                        operation: 'partial_tp_persist_failed',
                        errorCode: 'PARTIAL_TP_PERSIST_FAILED',
                        fingerprint: ['persistence', 'PARTIAL_TP_PERSIST_FAILED', 'post_fill'],
                        context: {
                            user_id: signal.user_id,
                            signal_id: signal.id,
                            broker_account_id: broker.id,
                            stage: 'post_fill_persistence',
                            extra: { trade_row_id: tradeRowId },
                        },
                    });
                }
            }
            if (prep.layeringRuntime?.onImmediateFill) {
                try {
                    await prep.layeringRuntime.onImmediateFill({
                        entryPrice: entryPx,
                        lot: result.lots ?? sendArgs.volume,
                        tradeRowId,
                        ticket: result.ticket ?? null,
                    });
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    await ctx.supabase.from('trade_execution_logs').insert({
                        user_id: signal.user_id,
                        signal_id: signal.id,
                        broker_account_id: broker.id,
                        action: 'layering_first_fill_activation',
                        status: 'reconciliation_required',
                        request_payload: {
                            broker_ticket_present: result.ticket != null,
                            trade_row_id_present: tradeRowId != null,
                            symbol: sendArgs.symbol,
                            operation: sendArgs.operation,
                        },
                        error_message: message,
                    });
                    throw err;
                }
            }
            const logRow = {
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
            };
            const { error: logErr } = await ctx.supabase.from('trade_execution_logs').insert(logRow);
            if (logErr) {
                console.error(`[tradeExecutor] order_send log INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${logErr.message}`);
                if ((0, ensureSignalRow_1.isSignalFkViolation)(logErr.message)) {
                    const ensured = await (0, ensureSignalRow_1.ensureSignalRow)(ctx.supabase, {
                        id: signal.id,
                        user_id: signal.user_id,
                        channel_id: signal.channel_id,
                        status: signal.status || 'parsed',
                        parsed_data: (signal.parsed_data ?? null),
                        telegram_message_id: signal.telegram_message_id ?? null,
                        reply_to_message_id: signal.reply_to_message_id ?? null,
                        parent_signal_id: signal.parent_signal_id,
                        is_modification: signal.is_modification,
                        raw_message: '',
                    });
                    if (ensured.ok) {
                        const { error: retryLogErr } = await ctx.supabase.from('trade_execution_logs').insert(logRow);
                        if (retryLogErr) {
                            console.error(`[tradeExecutor] order_send log retry failed signal=${signal.id} ticket=${result.ticket}: ${retryLogErr.message}`);
                        }
                    }
                }
            }
        };
        const insertTradeRowWithFkRetry = async () => {
            const first = await ctx.supabase
                .from('trades')
                .insert(tradeRowPayload)
                .select('id')
                .maybeSingle();
            if (!first.error) {
                return first.data?.id ?? null;
            }
            console.error(`[tradeExecutor] trades INSERT failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${first.error.message}`);
            (0, sentry_1.captureWorkerError)(first.error, {
                subsystem: 'persistence',
                operation: 'broker_success_trade_persist_failed',
                errorCode: 'BROKER_SUCCESS_DB_FAILURE',
                fingerprint: ['persistence', 'BROKER_SUCCESS_DB_FAILURE', 'trades_insert'],
                context: {
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    channel_id: signal.channel_id,
                    telegram_message_id: signal.telegram_message_id,
                    broker_account_id: broker.id,
                    stage: 'post_broker_success_persistence',
                    extra: {
                        broker_ticket_present: result.ticket != null,
                        leg: leg.idx + 1,
                        total: totalCount,
                    },
                },
            });
            if (!(0, ensureSignalRow_1.isSignalFkViolation)(first.error.message))
                return null;
            const ensured = await (0, ensureSignalRow_1.ensureSignalRow)(ctx.supabase, {
                id: signal.id,
                user_id: signal.user_id,
                channel_id: signal.channel_id,
                status: signal.status || 'parsed',
                parsed_data: (signal.parsed_data ?? null),
                telegram_message_id: signal.telegram_message_id ?? null,
                reply_to_message_id: signal.reply_to_message_id ?? null,
                parent_signal_id: signal.parent_signal_id,
                is_modification: signal.is_modification,
                raw_message: '',
            });
            if (!ensured.ok) {
                console.error(`[tradeExecutor] ensureSignalRow after trades FK fail signal=${signal.id}: ${ensured.error ?? 'unknown'}`);
                return null;
            }
            const retry = await ctx.supabase
                .from('trades')
                .insert(tradeRowPayload)
                .select('id')
                .maybeSingle();
            if (retry.error) {
                console.error(`[tradeExecutor] trades INSERT retry failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}: ${retry.error.message}`);
                (0, sentry_1.captureWorkerError)(retry.error, {
                    subsystem: 'persistence',
                    operation: 'broker_success_trade_persist_retry_failed',
                    errorCode: 'BROKER_SUCCESS_DB_FAILURE',
                    fingerprint: ['persistence', 'BROKER_SUCCESS_DB_FAILURE', 'trades_insert_retry'],
                    context: {
                        user_id: signal.user_id,
                        signal_id: signal.id,
                        channel_id: signal.channel_id,
                        telegram_message_id: signal.telegram_message_id,
                        broker_account_id: broker.id,
                        stage: 'post_broker_success_persistence_retry',
                        extra: { broker_ticket_present: result.ticket != null },
                    },
                });
                return null;
            }
            console.warn(`[tradeExecutor] trades INSERT recovered after ensureSignalRow signal=${signal.id} ticket=${result.ticket}`);
            return retry.data?.id ?? null;
        };
        if (liveEntryFast && prep.layeringRuntime?.onImmediateFill) {
            filledLeg.tradeRowId = await insertTradeRowWithFkRetry();
            filledLegs.push(filledLeg);
            await persistPostFillDb(filledLeg.tradeRowId);
            if (signal.pipeline_ts) {
                (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'execution_state_persisted_at', Date.now());
            }
        }
        else if (liveEntryFast) {
            filledLegs.push(filledLeg);
            void (async () => {
                const tradeRowId = await insertTradeRowWithFkRetry();
                filledLeg.tradeRowId = tradeRowId;
                await persistPostFillDb(tradeRowId);
                if (signal.pipeline_ts) {
                    (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'execution_state_persisted_at', Date.now());
                }
            })().catch(err => {
                console.error(`[tradeExecutor] post-fill persist failed signal=${signal.id} broker=${broker.id} ticket=${result.ticket}:`, err instanceof Error ? err.message : String(err));
                (0, sentry_1.captureWorkerError)(err instanceof Error ? err : new Error(String(err)), {
                    subsystem: 'persistence',
                    operation: 'post_fill_persist_failed',
                    errorCode: 'BROKER_SUCCESS_DB_FAILURE',
                    fingerprint: ['persistence', 'BROKER_SUCCESS_DB_FAILURE', 'post_fill_background'],
                    context: {
                        user_id: signal.user_id,
                        signal_id: signal.id,
                        broker_account_id: broker.id,
                        stage: 'post_fill_background',
                        extra: { broker_ticket_present: result.ticket != null },
                    },
                });
            });
        }
        else {
            filledLeg.tradeRowId = await insertTradeRowWithFkRetry();
            filledLegs.push(filledLeg);
            await persistPostFillDb(filledLeg.tradeRowId);
            if (signal.pipeline_ts) {
                (0, pipelineTimestamps_1.setPipelineTimestamp)(signal.pipeline_ts, 'execution_state_persisted_at', Date.now());
            }
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
    const rejectedSendReason = sendResults
        .find((r) => r.status === 'rejected')
        ?.reason;
    if (rejectedSendReason != null) {
        lastSendError = rejectedSendReason instanceof Error ? rejectedSendReason.message : String(rejectedSendReason);
    }
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
