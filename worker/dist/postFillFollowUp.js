"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPostFillFollowUp = applyPostFillFollowUp;
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const blackout_1 = require("./newsTrading/blackout");
const calendarProvider_1 = require("./newsTrading/calendarProvider");
const settings_1 = require("./newsTrading/settings");
const manualStops_1 = require("./manualPlanning/manualStops");
const manualStops_2 = require("./manualPlanning/manualStops");
const parsedEntry_1 = require("./manualPlanning/parsedEntry");
const orderModifyBenign_1 = require("./orderModifyBenign");
const deferredBusinessEvents_1 = require("./observability/deferredBusinessEvents");
function newsBlackoutPreFillEnabled() {
    const v = String(process.env.EXECUTOR_NEWS_BLACKOUT_PRE_FILL ?? 'false').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
async function applyPipAndChannelStops(args) {
    const { api, uuid, signal, parsed, broker, channelKeywords, symbol, params, filledLegs, plannedBrokerTp, hasPartialTpSchedule, } = args;
    const manual = (broker.manual_settings ?? {});
    const isSingleTradeStyle = (manual.trade_style ?? 'single') !== 'multi';
    if (!isSingleTradeStyle) {
        // Multi-trade legs already carry per-bucket TPs from the planner; syncMultiBasketLegTakeProfits
        // reconciles them. Flattening to tp[0] here caused wrong targets on layered baskets.
        return;
    }
    const isBuy = !String(parsed.action ?? '').toLowerCase().includes('sell');
    for (const leg of filledLegs) {
        const entry = leg.entryPrice;
        if (entry == null || !Number.isFinite(entry) || entry <= 0)
            continue;
        if (!Number.isFinite(leg.ticket) || leg.ticket <= 0)
            continue;
        let plannerParsed = { ...parsed };
        if (signal.channel_id
            && (0, channelActiveTradeParams_1.shouldMergeChannelParamsForEntry)(plannerParsed)
            && !(0, channelActiveTradeParams_1.shouldPreferParsedStopsOnEntry)(plannerParsed)) {
            const channelParams = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(args.supabase, signal.user_id, signal.channel_id, symbol);
            if (channelParams) {
                plannerParsed = (0, channelActiveTradeParams_1.mergeParsedWithChannelParams)(plannerParsed, channelParams);
            }
        }
        const ctx = {
            point: Number(params?.point ?? 0.00001),
            digits: Number(params?.digits ?? 5),
            minLot: Number(params?.minLot ?? 0.01),
            lotStep: Number(params?.lotStep ?? 0.01),
            contractSize: params?.contractSize != null ? Number(params.contractSize) : null,
            stopsLevel: Number(params?.stopsLevel ?? 0),
            freezeLevel: Number(params?.freezeLevel ?? 0),
            defaultLot: Number(broker.default_lot_size ?? 0.01),
            lastBalance: broker.last_balance ?? null,
        };
        let targetSl = leg.openSl;
        let targetTp = leg.openTp;
        if (hasPartialTpSchedule && plannedBrokerTp != null && plannedBrokerTp > 0) {
            targetTp = plannedBrokerTp;
        }
        else if ((0, manualStops_2.usesPredefinedStops)(manual)) {
            const derived = (0, manualStops_1.deriveManualStopsWithClamp)({
                parsed: plannerParsed,
                manual,
                channelKeywords,
                resolvedSymbol: symbol,
                ctx,
                entryAnchor: entry,
                isBuy,
            });
            if (derived.finalSl != null)
                targetSl = derived.roundPrice(derived.finalSl);
            if (derived.finalTps.length) {
                const lastTp = derived.finalTps[derived.finalTps.length - 1] ?? derived.finalTps[0];
                targetTp = derived.roundPrice(lastTp);
            }
        }
        else if ((0, channelActiveTradeParams_1.shouldMergeChannelParamsForEntry)(plannerParsed)) {
            if (plannerParsed.sl != null)
                targetSl = plannerParsed.sl;
            const lastTp = (0, parsedEntry_1.lastPositiveParsedTpPrice)(plannerParsed);
            if (lastTp != null)
                targetTp = lastTp;
        }
        const stripped = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
            stoploss: Number(targetSl) || 0,
            takeprofit: Number(targetTp) || 0,
            referencePrice: entry,
            isBuy,
        });
        const newSl = stripped.stoploss > 0 ? stripped.stoploss : null;
        const newTp = stripped.takeprofit > 0 ? stripped.takeprofit : null;
        const slChanged = newSl != null && newSl !== leg.openSl;
        const tpChanged = newTp != null && newTp !== leg.openTp;
        if (!slChanged && !tpChanged)
            continue;
        try {
            await api.orderModify(uuid, {
                ticket: leg.ticket,
                stoploss: newSl,
                takeprofit: newTp,
            });
            if (leg.tradeRowId) {
                await args.supabase
                    .from('trades')
                    .update({ sl: newSl, tp: newTp })
                    .eq('id', leg.tradeRowId);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if ((0, orderModifyBenign_1.isBenignOrderModifyError)(msg))
                continue;
            console.warn(`[postFillFollowUp] OrderModify stops failed signal=${signal.id} ticket=${leg.ticket}: ${msg}`);
            (0, deferredBusinessEvents_1.captureDeferredBusinessFailure)({
                category: 'management',
                event: slChanged && !tpChanged ? 'stop_loss_update_failed' : tpChanged && !slChanged ? 'take_profit_update_failed' : 'deferred_trade_follow_up_failed',
                severity: 'error',
                reasonCode: slChanged && !tpChanged ? 'POST_FILL_SL_UPDATE_FAILED' : tpChanged && !slChanged ? 'POST_FILL_TP_UPDATE_FAILED' : 'POST_FILL_STOPS_UPDATE_FAILED',
                message: 'Post-fill stop update failed after broker entry success',
                userImpact: 'partial',
                operation: 'post_fill_stop_update',
                err,
                context: {
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    channel_id: signal.channel_id,
                    broker_account_id: broker.id,
                    trade_id: leg.tradeRowId,
                    symbol,
                    side: isBuy ? 'buy' : 'sell',
                    extra: {
                        broker_ticket_present: true,
                        stop_loss_targeted: slChanged,
                        take_profit_targeted: tpChanged,
                        failed_count: 1,
                    },
                },
            });
        }
    }
}
/** Run deferred management after live market fill. */
async function applyPostFillFollowUp(args) {
    const { hooks, signal, parsed, broker, symbol } = args;
    const manual = (broker.manual_settings ?? {});
    await applyPipAndChannelStops(args);
    if (manual.close_on_opposite_signal === true) {
        await hooks.closeOppositeDirectionTrades(signal, parsed, broker, symbol);
    }
    // Basket SL/TP refresh and add-to-existing merge run in sendOrder before OrderSend.
    if (!newsBlackoutPreFillEnabled() && !(0, settings_1.isNewsTradingEnabled)(manual)) {
        try {
            const events = await (0, calendarProvider_1.getCalendarEventsCached)();
            const blackout = (0, blackout_1.findActiveNewsBlackout)(events, manual, symbol);
            if (blackout) {
                await args.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'post_fill_news_audit',
                    status: 'skipped',
                    request_payload: {
                        symbol,
                        phase: blackout.phase,
                        event: blackout.event.event,
                        note: 'fill already placed; audit only',
                    },
                });
            }
        }
        catch {
            /* audit only */
        }
    }
}
