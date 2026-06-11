"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.symbolsCompatibleForBasket = symbolsCompatibleForBasket;
exports.mgmtSignalMatchesBasketSymbol = mgmtSignalMatchesBasketSymbol;
exports.tryApplyBasketFollowUpToNewFill = tryApplyBasketFollowUpToNewFill;
const normalizeManualSettings_1 = require("./manualPlanning/normalizeManualSettings");
const channelTradingConfig_1 = require("./channelTradingConfig");
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const tpBucketDistribution_1 = require("./manualPlanning/tpBucketDistribution");
const orderModifyBenign_1 = require("./orderModifyBenign");
function sanitizeLevel(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
function positiveTps(parsed) {
    return (parsed?.tp ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t) && t > 0);
}
function symbolsCompatibleForBasket(signalSym, brokerSym) {
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const a = norm(String(signalSym ?? ''));
    const b = norm(String(brokerSym ?? ''));
    if (!a.length || !b.length)
        return false;
    return a === b || b.includes(a) || a.includes(b);
}
/** Symbol-less modify/breakeven messages apply to the whole channel basket for `brokerSymbol`. */
function mgmtSignalMatchesBasketSymbol(parsed, brokerSymbol) {
    const act = String(parsed.action ?? '').toLowerCase();
    if (act === 'modify' || act === 'breakeven') {
        const sym = parsed.symbol;
        if (sym == null || String(sym).trim() === '')
            return true;
        return symbolsCompatibleForBasket(sym, brokerSymbol);
    }
    return symbolsCompatibleForBasket(parsed.symbol, brokerSymbol);
}
function computeFollowUpStops(ctx, source) {
    const act = String(source.action ?? 'modify').toLowerCase();
    if (act === 'breakeven') {
        const entry = sanitizeLevel(ctx.entryPrice);
        if (entry <= 0)
            return null;
        return {
            stoploss: entry,
            takeprofit: sanitizeLevel(ctx.existingTp),
            dbPatch: { sl: entry },
        };
    }
    const hasNewSl = typeof source.sl === 'number' && Number.isFinite(source.sl) && source.sl > 0;
    const signalTps = positiveTps({ tp: source.tpLevels ?? null });
    const anchorTps = positiveTps(ctx.anchorParsed);
    const finalTps = signalTps.length ? signalTps : anchorTps;
    const hasNewTp = finalTps.length > 0;
    if (!hasNewSl && !hasNewTp)
        return null;
    const stoploss = hasNewSl ? source.sl : sanitizeLevel(ctx.existingSl);
    let takeprofit = sanitizeLevel(ctx.existingTp);
    const dbPatch = {};
    if (hasNewSl)
        dbPatch.sl = source.sl;
    if (hasNewTp) {
        const idx = ctx.legIndex >= 0 ? ctx.legIndex : ctx.openCount - 1;
        takeprofit = (0, tpBucketDistribution_1.takeProfitForSplitBasketLeg)({
            legIndex: idx,
            immediateLegCount: ctx.immediateLegCount,
            rangeLegCount: ctx.rangeLegCount,
            finalTps,
            tpLots: ctx.tpLots,
        });
        if (takeprofit <= 0) {
            takeprofit = finalTps[finalTps.length - 1];
        }
        if (takeprofit > 0)
            dbPatch.tp = takeprofit;
    }
    return { stoploss, takeprofit, dbPatch };
}
async function executeFollowUpModify(supabase, api, args) {
    try {
        await api.orderModify(args.metaUuid, {
            ticket: args.ticket,
            stoploss: args.stoploss,
            takeprofit: args.takeprofit,
        });
        if (Object.keys(args.dbPatch).length > 0) {
            await supabase.from('trades').update(args.dbPatch).eq('id', args.tradeRowId);
        }
        await supabase.from('trade_execution_logs').insert({
            user_id: args.userId,
            signal_id: args.sourceSignalId,
            broker_account_id: args.brokerAccountId,
            action: 'mgmt_range_leg_followup',
            status: 'success',
            request_payload: {
                ticket: args.ticket,
                trade_id: args.tradeRowId,
                leg_index: args.legIndex >= 0 ? args.legIndex + 1 : null,
                stoploss: args.stoploss,
                takeprofit: args.takeprofit,
                basket_signal_id: args.basketSignalId,
            },
        });
        return true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const benign = (0, orderModifyBenign_1.isBenignOrderModifyError)(msg);
        await supabase.from('trade_execution_logs').insert({
            user_id: args.userId,
            signal_id: args.sourceSignalId,
            broker_account_id: args.brokerAccountId,
            action: 'mgmt_range_leg_followup',
            status: benign ? 'success' : 'failed',
            error_message: benign ? null : msg,
            request_payload: {
                ticket: args.ticket,
                trade_id: args.tradeRowId,
                basket_signal_id: args.basketSignalId,
            },
        });
        return benign;
    }
}
/**
 * When a virtual range leg fills after an SL/TP (or breakeven) message was already
 * processed for the basket, apply the newest matching management instruction to this
 * position immediately (do not wait for the trade-executor sweep).
 */
async function tryApplyBasketFollowUpToNewFill(supabase, api, args) {
    const { data: basket } = await supabase
        .from('signals')
        .select('channel_id, created_at, parsed_data')
        .eq('id', args.basketSignalId)
        .maybeSingle();
    const channelId = basket?.channel_id;
    const createdAt = basket?.created_at;
    const anchorParsed = basket?.parsed_data;
    if (!channelId || !createdAt)
        return;
    let tpLots = args.tpLots;
    if (tpLots === undefined) {
        const { data: br } = await supabase
            .from('broker_accounts')
            .select('manual_settings, channel_trading_configs, copier_mode, ai_settings')
            .eq('id', args.brokerAccountId)
            .maybeSingle();
        tpLots = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)((0, channelTradingConfig_1.resolveChannelTradingConfig)((br ?? {}), channelId).manual_settings).tp_lots;
    }
    const { data: openLegs } = await supabase
        .from('trades')
        .select('id')
        .eq('broker_account_id', args.brokerAccountId)
        .eq('signal_id', args.basketSignalId)
        .eq('status', 'open')
        .order('opened_at', { ascending: true })
        .limit(500);
    const legIndex = (openLegs ?? []).findIndex(r => r.id === args.tradeRowId);
    const { data: pendingRows } = await supabase
        .from('range_pending_legs')
        .select('step_idx')
        .eq('broker_account_id', args.brokerAccountId)
        .eq('signal_id', args.basketSignalId)
        .in('status', ['pending', 'claimed'])
        .limit(500);
    const openCount = openLegs?.length ?? 0;
    const activePendingCount = pendingRows?.length ?? 0;
    const maxPendingStepIdx = Math.max(0, ...(pendingRows ?? []).map(r => Number(r.step_idx) || 0));
    const totalPlannedLegs = (0, channelActiveTradeParams_1.estimateBasketTotalPlannedLegs)({
        openLegCount: openCount,
        activePendingCount,
        maxPendingStepIdx,
    });
    const firedPendingApprox = Math.max(0, maxPendingStepIdx - activePendingCount);
    const immediateLegCount = Math.max(0, openCount - firedPendingApprox);
    const rangeLegCount = Math.max(0, totalPlannedLegs - immediateLegCount);
    const legCtx = {
        legIndex,
        openCount,
        immediateLegCount,
        rangeLegCount,
        tpLots,
        anchorParsed,
        existingSl: args.existingSl,
        existingTp: args.existingTp,
        entryPrice: args.entryPrice,
    };
    const channelParams = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(supabase, args.userId, channelId, args.symbol);
    if (channelParams && (0, channelActiveTradeParams_1.channelParamsPredateBasket)(channelParams, createdAt)) {
        // Memory left over from an older signal cycle (clearing was blocked, e.g.
        // by ghost open rows). Applying it gives wrong-side "Invalid stops".
        console.log(`[basketModFollowUp] skip stale channel memory basket=${args.basketSignalId}`
            + ` symbol=${args.symbol} memory_updated=${channelParams.updatedAt}`
            + ` basket_created=${createdAt}`);
    }
    else if (channelParams) {
        const channelStops = computeFollowUpStops(legCtx, {
            action: 'modify',
            sl: channelParams.stoploss,
            tpLevels: channelParams.tpLevels,
        });
        if (channelStops) {
            let stops = channelStops;
            const entryRef = sanitizeLevel(args.entryPrice);
            if (entryRef > 0 && args.isBuy != null) {
                const stripped = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
                    stoploss: channelStops.stoploss,
                    takeprofit: channelStops.takeprofit,
                    referencePrice: entryRef,
                    isBuy: args.isBuy,
                });
                if (stripped.stripped.length) {
                    console.warn(`[basketModFollowUp] channel memory stops on wrong side basket=${args.basketSignalId}`
                        + ` ticket=${args.ticket} dropped: ${stripped.stripped.join(', ')}`);
                    const dbPatch = { ...channelStops.dbPatch };
                    if (stripped.stoploss <= 0)
                        delete dbPatch.sl;
                    if (stripped.takeprofit <= 0)
                        delete dbPatch.tp;
                    stops = {
                        stoploss: stripped.stoploss > 0 ? stripped.stoploss : sanitizeLevel(legCtx.existingSl),
                        takeprofit: stripped.takeprofit > 0 ? stripped.takeprofit : sanitizeLevel(legCtx.existingTp),
                        dbPatch,
                    };
                }
            }
            const changesAnything = stops.stoploss !== sanitizeLevel(legCtx.existingSl)
                || stops.takeprofit !== sanitizeLevel(legCtx.existingTp);
            if (changesAnything) {
                const applied = await executeFollowUpModify(supabase, api, {
                    userId: args.userId,
                    brokerAccountId: args.brokerAccountId,
                    metaUuid: args.metaUuid,
                    ticket: args.ticket,
                    tradeRowId: args.tradeRowId,
                    basketSignalId: args.basketSignalId,
                    sourceSignalId: args.basketSignalId,
                    legIndex,
                    ...stops,
                });
                if (applied)
                    return;
            }
        }
    }
    const { data: candidates } = await supabase
        .from('signals')
        .select('id, parsed_data, created_at, is_modification')
        .eq('user_id', args.userId)
        .eq('channel_id', channelId)
        .in('status', ['parsed', 'executed'])
        .gte('created_at', createdAt)
        .order('created_at', { ascending: false })
        .limit(60);
    for (const row of candidates ?? []) {
        const parsed = row.parsed_data;
        if (!parsed?.action)
            continue;
        const act = String(parsed.action).toLowerCase();
        if (act !== 'modify' && act !== 'breakeven')
            continue;
        if (!mgmtSignalMatchesBasketSymbol(parsed, args.symbol))
            continue;
        const stops = computeFollowUpStops(legCtx, {
            action: act,
            sl: parsed.sl,
            tpLevels: parsed.tp,
        });
        if (!stops)
            continue;
        const applied = await executeFollowUpModify(supabase, api, {
            userId: args.userId,
            brokerAccountId: args.brokerAccountId,
            metaUuid: args.metaUuid,
            ticket: args.ticket,
            tradeRowId: args.tradeRowId,
            basketSignalId: args.basketSignalId,
            sourceSignalId: row.id,
            legIndex,
            ...stops,
        });
        if (applied)
            return;
    }
}
