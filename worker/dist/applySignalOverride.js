"use strict";
/**
 * Apply user signal SL/TP overrides to open broker legs for a signal basket.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySignalOverride = applySignalOverride;
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const brokerChannelFilter_1 = require("./brokerChannelFilter");
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const basketTargetStore_1 = require("./basketTargetStore");
const fxsocketClient_1 = require("./fxsocketClient");
const tpBucketDistribution_1 = require("./manualPlanning/tpBucketDistribution");
const orderModifyBenign_1 = require("./orderModifyBenign");
const parallelPool_1 = require("./parallelPool");
const signalOverride_1 = require("./signalOverride");
const channelActiveTradeParams_2 = require("./channelActiveTradeParams");
const helpers_1 = require("./tradeExecutor/helpers");
const managementScope_1 = require("./managementScope");
function num(v) {
    if (v == null)
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
async function applySignalOverride(supabase, args) {
    const dryRun = args.dryRun === true;
    const errors = [];
    let appliedLegs = 0;
    let skippedLegs = 0;
    let failedLegs = 0;
    const { data: signal, error: sigErr } = await supabase
        .from('signals')
        .select('id,user_id,channel_id,parsed_data,user_override')
        .eq('id', args.signalId)
        .eq('user_id', args.userId)
        .maybeSingle();
    if (sigErr || !signal) {
        throw sigErr ?? new Error(`signal not found: ${args.signalId}`);
    }
    const effective = (0, signalOverride_1.effectiveParsedFromSignalRow)(signal);
    const overrideMeta = (0, signalOverride_1.parseUserOverride)(signal.user_override);
    const instructionAt = overrideMeta?.updated_at ?? new Date().toISOString();
    const targetSl = num(effective.sl);
    const targetTps = (effective.tp ?? []).filter((t) => num(t) != null);
    if (targetSl == null && targetTps.length === 0) {
        return { applied_legs: 0, skipped_legs: 0, failed_legs: 0, errors: ['no_sl_or_tp_in_override'] };
    }
    const channelId = signal.channel_id ?? null;
    let rows = [];
    let brokersMissing = [];
    if (channelId) {
        const { data: brokerRows } = await supabase
            .from('broker_accounts')
            .select('id,signal_channel_ids,is_active,fxsocket_account_id,metaapi_account_id')
            .eq('user_id', args.userId)
            .eq('is_active', true);
        const brokerAccountIds = (brokerRows ?? [])
            .filter(b => (0, brokerChannelFilter_1.channelMatchesBrokerSignal)(b, channelId))
            .map(b => b.id);
        if (brokerAccountIds.length) {
            // Signal-scoped (not channel-wide) so every linked broker that holds this
            // signal's legs is covered without truncation and without cross-signal bleed.
            const scoped = await (0, managementScope_1.loadOpenTradesForSignalAcrossBrokers)(supabase, {
                userId: args.userId,
                signalId: args.signalId,
                brokerAccountIds,
            });
            brokersMissing = scoped.brokersMissing;
            rows = scoped.rows
                .filter(r => r.status === 'open' && r.metaapi_order_id)
                .map(r => ({
                id: r.id,
                signal_id: r.signal_id,
                broker_account_id: r.broker_account_id,
                metaapi_order_id: r.metaapi_order_id,
                symbol: r.symbol,
                direction: r.direction,
                sl: r.sl,
                tp: r.tp,
                opened_at: r.opened_at ?? '',
                entry_price: r.entry_price,
                lot_size: r.lot_size,
            }));
        }
    }
    if (!rows.length) {
        const { data: trades, error: trErr } = await supabase
            .from('trades')
            .select('id,signal_id,broker_account_id,metaapi_order_id,symbol,direction,sl,tp,opened_at,entry_price,lot_size')
            .eq('user_id', args.userId)
            .eq('signal_id', args.signalId)
            .eq('status', 'open')
            .not('metaapi_order_id', 'is', null)
            .order('opened_at', { ascending: true });
        if (trErr)
            throw trErr;
        rows = (trades ?? []);
    }
    if (!rows.length) {
        return { applied_legs: 0, skipped_legs: 0, failed_legs: 0, brokers_missing: brokersMissing };
    }
    if (!dryRun && !(0, fxsocketClient_1.hasFxsocketConfigured)()) {
        throw new Error('FXSOCKET_API_KEY not set — cannot call broker');
    }
    const brokerIds = [...new Set(rows.map(r => r.broker_account_id))];
    const { data: brokers } = await supabase
        .from('broker_accounts')
        .select('id,label,platform,fxsocket_account_id,metaapi_account_id,manual_settings')
        .in('id', brokerIds);
    const brokerById = new Map((brokers ?? []).map(b => [b.id, b]));
    const api = (0, fxsocketClient_1.getFxsocketClient)();
    // Apply one broker basket. Each broker targets a distinct MT terminal, so
    // brokers run in parallel (bounded); legs within a broker stay sequential
    // because they share one terminal's request gate.
    const processBroker = async (brokerId) => {
        const legCount = rows.filter(r => r.broker_account_id === brokerId).length;
        const localErrors = [];
        let applied = 0;
        let skipped = 0;
        let failed = 0;
        const broker = brokerById.get(brokerId);
        const uuid = broker ? (0, helpers_1.brokerSessionUuid)(broker) : null;
        if (!broker || !uuid || !(0, helpers_1.brokerHasLinkedSession)(broker)) {
            return { outcome: { broker_id: brokerId, applied: 0, skipped: legCount, failed: 0 }, errors: localErrors };
        }
        const client = api;
        if (!client && !dryRun) {
            localErrors.push(`broker ${brokerId}: fxsocket client unavailable`);
            return { outcome: { broker_id: brokerId, applied: 0, skipped: legCount, failed: 0 }, errors: localErrors };
        }
        client?.seedPlatformCache(uuid, (0, fxsocketClient_1.mtPlatformFrom)(broker.platform));
        const legs = rows
            .filter(r => r.broker_account_id === brokerId)
            .sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
        const isBuy = String(legs[0]?.direction ?? '').toLowerCase() === 'buy';
        const tpLots = broker.manual_settings?.tp_lots ?? null;
        const tpMap = targetTps.length > 0
            ? (0, tpBucketDistribution_1.buildEntryQualityTakeProfitMap)({
                legs: legs.map(tr => ({
                    id: tr.id,
                    entryPrice: Number(tr.entry_price ?? 0),
                    openedAt: tr.opened_at,
                })),
                isBuy,
                slotLegCount: legs.length,
                finalTps: targetTps,
                tpLots: tpLots ?? null,
            })
            : new Map();
        let quoteRef = null;
        let symbolParams = null;
        const quoteSymbol = legs[0]?.symbol?.trim();
        if (client && quoteSymbol && !dryRun) {
            try {
                const q = await client.quote(uuid, quoteSymbol);
                const marketRef = isBuy ? q.bid : q.ask;
                if (Number.isFinite(marketRef) && marketRef > 0)
                    quoteRef = marketRef;
            }
            catch {
                /* optional — fall back to entry for side checks */
            }
            try {
                const sp = await client.symbolParams(uuid, quoteSymbol);
                const n = (0, fxsocketClient_1.normalizeSymbolParams)(sp);
                symbolParams = {
                    digits: n.digits ?? 5,
                    point: n.point ?? 0.00001,
                    minLot: n.minLot ?? 0.01,
                    lotStep: n.lotStep ?? 0.01,
                    contractSize: n.contractSize ?? null,
                    stopsLevel: n.stopsLevel ?? 0,
                    freezeLevel: n.freezeLevel ?? 0,
                };
            }
            catch {
                /* optional — modify without broker min-distance clamp */
            }
        }
        for (let i = 0; i < legs.length; i++) {
            const tr = legs[i];
            const ticket = Number(tr.metaapi_order_id);
            if (!Number.isFinite(ticket) || ticket <= 0) {
                skipped++;
                continue;
            }
            const keepTp = num(tr.tp);
            const keepSl = num(tr.sl);
            let targetTp = targetTps.length > 0 ? (tpMap.get(tr.id) ?? keepTp) : keepTp;
            let targetSlForLeg = targetSl ?? keepSl;
            const ref = (quoteRef != null && quoteRef > 0) ? quoteRef : num(tr.entry_price);
            if (ref != null && ref > 0 && (targetSlForLeg != null || targetTp != null)) {
                const stripped = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
                    stoploss: targetSlForLeg ?? 0,
                    takeprofit: targetTp ?? 0,
                    referencePrice: ref,
                    isBuy,
                });
                if (targetSlForLeg != null) {
                    targetSlForLeg = stripped.stoploss > 0 ? stripped.stoploss : null;
                }
                if (targetTp != null) {
                    targetTp = stripped.takeprofit > 0 ? stripped.takeprofit : null;
                }
            }
            if (ref != null && ref > 0 && symbolParams && (targetSlForLeg != null || targetTp != null)) {
                const clamped = (0, basketSlTpReconcile_1.clampBasketOrderStops)({
                    symbol: quoteSymbol ?? tr.symbol,
                    operation: isBuy ? 'Buy' : 'Sell',
                    volume: 0.01,
                    price: ref,
                    stoploss: targetSlForLeg ?? 0,
                    takeprofit: targetTp ?? 0,
                }, symbolParams);
                if (targetSlForLeg != null && clamped.args.stoploss && clamped.args.stoploss > 0) {
                    targetSlForLeg = clamped.args.stoploss;
                }
                if (targetTp != null && clamped.args.takeprofit && clamped.args.takeprofit > 0) {
                    targetTp = clamped.args.takeprofit;
                }
            }
            if (targetSlForLeg == null && targetTp == null) {
                skipped++;
                continue;
            }
            if (targetSlForLeg != null
                && targetTp != null
                && (0, orderModifyBenign_1.stopsAlreadyMatchDb)({ sl: tr.sl, tp: tr.tp }, { stoploss: targetSlForLeg, takeprofit: targetTp }, 0, 0)) {
                skipped++;
                continue;
            }
            if (dryRun) {
                applied++;
                continue;
            }
            try {
                const modifyArgs = { ticket };
                if (targetSlForLeg != null && targetSlForLeg > 0)
                    modifyArgs.stoploss = targetSlForLeg;
                if (targetTp != null && targetTp > 0)
                    modifyArgs.takeprofit = targetTp;
                if (modifyArgs.stoploss == null && modifyArgs.takeprofit == null) {
                    skipped++;
                    continue;
                }
                await client.orderModify(uuid, modifyArgs);
                const dbPatch = {};
                if (targetSlForLeg != null)
                    dbPatch.sl = targetSlForLeg;
                if (targetTp != null)
                    dbPatch.tp = targetTp;
                if (Object.keys(dbPatch).length > 0) {
                    await supabase.from('trades').update(dbPatch).eq('id', tr.id);
                }
                try {
                    await supabase.from('trade_execution_logs').insert({
                        user_id: args.userId,
                        signal_id: args.signalId,
                        broker_account_id: brokerId,
                        action: 'user_signal_override',
                        status: 'success',
                        request_payload: {
                            ticket,
                            target_sl: modifyArgs.stoploss ?? null,
                            target_tp: modifyArgs.takeprofit ?? null,
                            trade_id: tr.id,
                            leg_index: i + 1,
                        },
                    });
                }
                catch {
                    // best-effort log — broker modify already succeeded
                }
                applied++;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if ((0, orderModifyBenign_1.isBenignOrderModifyError)(msg)) {
                    skipped++;
                    continue;
                }
                failed++;
                localErrors.push(`leg ${tr.id}: ${msg}`);
                try {
                    await supabase.from('trade_execution_logs').insert({
                        user_id: args.userId,
                        signal_id: args.signalId,
                        broker_account_id: brokerId,
                        action: 'user_signal_override',
                        status: 'failed',
                        error_message: msg,
                        request_payload: {
                            ticket,
                            trade_id: tr.id,
                            leg_index: i + 1,
                        },
                    });
                }
                catch {
                    // best-effort log
                }
            }
        }
        // Any broker leg that failed to modify is queued for the reconcile monitor
        // so the override SL/TP heals even if the live apply was partial.
        if (!dryRun && failed > 0 && legs.length) {
            try {
                await queueOverrideReconcile({
                    supabase,
                    userId: args.userId,
                    sourceSignalId: args.signalId,
                    channelId,
                    brokerId,
                    legs,
                    isBuy,
                    targetSl,
                    targetTps,
                    tpMap,
                    tpLots,
                    failed,
                });
            }
            catch (e) {
                localErrors.push(`broker ${brokerId}: reconcile enqueue failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return { outcome: { broker_id: brokerId, applied, skipped, failed }, errors: localErrors };
    };
    const perBroker = await (0, parallelPool_1.parallelMap)(brokerIds, (0, parallelPool_1.mgmtBasketConcurrency)(), processBroker);
    for (const { outcome, errors: be } of perBroker) {
        appliedLegs += outcome.applied;
        skippedLegs += outcome.skipped;
        failedLegs += outcome.failed;
        for (const e of be)
            errors.push(e);
    }
    // Keep authoritative basket targets + pending ladder legs aligned with the override
    // so reconcile monitors do not revert to pre-override SL/TP.
    if (!dryRun && channelId && (targetSl != null || targetTps.length > 0)) {
        const symbolHint = String(effective.symbol ?? rows[0]?.symbol ?? '').trim();
        const signalIds = [...new Set(rows.map(r => r.signal_id))];
        const tpLotsByBroker = new Map();
        for (const brokerId of brokerIds) {
            tpLotsByBroker.set(brokerId, brokerById.get(brokerId)?.manual_settings?.tp_lots ?? null);
        }
        if (symbolHint) {
            const openLegCountByBasket = new Map();
            for (const row of rows) {
                const key = `${row.signal_id}|${row.broker_account_id}`;
                openLegCountByBasket.set(key, (openLegCountByBasket.get(key) ?? 0) + 1);
            }
            try {
                await (0, channelActiveTradeParams_2.reapplyChannelParamsToPendingLegs)({
                    supabase,
                    userId: args.userId,
                    channelId,
                    brokerAccountIds: brokerIds,
                    symbolHint,
                    signalIds,
                    tpLotsByBroker,
                    openLegCountByBasket,
                    paramsOverride: {
                        symbol: symbolHint,
                        stoploss: targetSl,
                        tpLevels: targetTps,
                        updatedAt: instructionAt,
                    },
                });
            }
            catch (e) {
                errors.push(`pending_legs_refresh: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        const basketsByBroker = new Map();
        for (const row of rows) {
            const list = basketsByBroker.get(row.broker_account_id) ?? [];
            list.push(row);
            basketsByBroker.set(row.broker_account_id, list);
        }
        for (const [brokerId, legs] of basketsByBroker) {
            const anchorSignalId = legs[0]?.signal_id;
            const sym = legs[0]?.symbol ?? symbolHint;
            if (!anchorSignalId || !sym)
                continue;
            try {
                await (0, basketTargetStore_1.upsertBasketSlTpTarget)(supabase, {
                    userId: args.userId,
                    brokerAccountId: brokerId,
                    anchorSignalId,
                    channelId,
                    symbol: sym,
                    stoploss: targetSl,
                    tpLevels: targetTps,
                    source: 'adjust',
                    instructionAt,
                });
            }
            catch (e) {
                errors.push(`basket_target broker=${brokerId}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
    return {
        applied_legs: appliedLegs,
        skipped_legs: skippedLegs,
        failed_legs: failedLegs,
        errors: errors.length ? errors : undefined,
        brokers: perBroker.map(p => p.outcome),
        brokers_missing: brokersMissing.length ? brokersMissing : undefined,
    };
}
/** Queue a basket reconcile job so the monitor re-applies override SL/TP that failed live. */
async function queueOverrideReconcile(args) {
    const { legs, targetSl, targetTps, tpMap } = args;
    const anchorSignalId = legs[0].signal_id;
    const familyTrades = legs.map(l => ({
        id: l.id,
        signal_id: l.signal_id,
        metaapi_order_id: l.metaapi_order_id,
        opened_at: l.opened_at,
        lot_size: Number(l.lot_size ?? 0),
        sl: l.sl,
        tp: l.tp,
        entry_price: l.entry_price,
        direction: l.direction,
        symbol: l.symbol,
    }));
    const perLegTargets = legs.map(l => ({
        stoploss: targetSl ?? l.sl ?? 0,
        takeprofit: (targetTps.length ? (tpMap.get(l.id) ?? l.tp) : l.tp) ?? 0,
    }));
    await (0, basketSlTpReconcile_1.upsertBasketReconcileJob)(args.supabase, {
        userId: args.userId,
        brokerAccountId: args.brokerId,
        anchorSignalId,
        sourceSignalId: args.sourceSignalId,
        channelId: args.channelId,
        symbol: legs[0].symbol,
        direction: args.isBuy ? 'buy' : 'sell',
        perLegTargets,
        familyTrades,
        signalTps: targetTps,
        tpLots: args.tpLots ?? null,
        virtualPendingsSnapshot: null,
        nImmCwe: 0,
        overrideTp: null,
        lastError: `user_signal_override partial: ${args.failed} leg(s) failed`,
    });
}
