"use strict";
/**
 * Canonical channel SL/TP apply — shared by live mgmt, reconcile, and diagnostics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mgmtUseChannelStopApply = mgmtUseChannelStopApply;
exports.groupLegsByBrokerSignal = groupLegsByBrokerSignal;
exports.ensureChannelModifyScope = ensureChannelModifyScope;
exports.allChannelModifySymbolBuckets = allChannelModifySymbolBuckets;
exports.brokerOrderSlMatchesTarget = brokerOrderSlMatchesTarget;
exports.fetchBrokerOrdersByTicket = fetchBrokerOrdersByTicket;
exports.verifyLegStopOnBroker = verifyLegStopOnBroker;
exports.applyChannelStopsToBaskets = applyChannelStopsToBaskets;
exports.logMgmtModifyBrokerSummaries = logMgmtModifyBrokerSummaries;
exports.mgmtRowsToStopLegs = mgmtRowsToStopLegs;
exports.expandAndGroupChannelModifyLegs = expandAndGroupChannelModifyLegs;
const fxsocketClient_1 = require("./fxsocketClient");
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const tpBucketDistribution_1 = require("./manualPlanning/tpBucketDistribution");
const orderModifyBenign_1 = require("./orderModifyBenign");
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const managementScope_1 = require("./managementScope");
const signalEntryPendingHelpers_1 = require("./signalEntryPendingHelpers");
const helpers_1 = require("./tradeExecutor/helpers");
const workerMetrics_1 = require("./workerMetrics");
const SL_VERIFY_TOLERANCE = 1e-6;
function mgmtUseChannelStopApply() {
    const v = String(process.env.MGMT_USE_CHANNEL_STOP_APPLY ?? 'true').toLowerCase().trim();
    return v !== '0' && v !== 'false' && v !== 'no';
}
function positiveNum(v) {
    if (v == null)
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function mgmtRowToLeg(row) {
    return {
        id: row.id,
        signal_id: row.signal_id,
        broker_account_id: row.broker_account_id,
        metaapi_order_id: row.metaapi_order_id,
        symbol: row.symbol,
        direction: row.direction,
        sl: row.sl,
        tp: row.tp,
        opened_at: row.opened_at,
        entry_price: row.entry_price,
        telegram_channel_id: null,
        lot_size: row.lot_size,
    };
}
function groupLegsByBrokerSignal(legs) {
    const map = new Map();
    for (const leg of legs) {
        const key = `${leg.broker_account_id}|${leg.signal_id}`;
        const list = map.get(key) ?? [];
        list.push(leg);
        map.set(key, list);
    }
    return map;
}
/**
 * Merge channel modify scope so every linked broker with open channel legs is included.
 */
async function ensureChannelModifyScope(supabase, args) {
    const { userId, channelId, brokerAccountIds } = args;
    if (!channelId || !brokerAccountIds.length)
        return [];
    const byId = new Map();
    const ingest = (rows) => {
        for (const row of rows)
            byId.set(row.id, row);
    };
    ingest(await (0, managementScope_1.loadOpenTradesForManagement)(supabase, {
        userId,
        channelId,
        brokerAccountIds,
        symbolFilter: args.symbolFilter,
    }));
    for (const brokerId of brokerAccountIds) {
        ingest(await (0, managementScope_1.loadOpenTradesForManagement)(supabase, {
            userId,
            channelId,
            brokerAccountIds: [brokerId],
            symbolFilter: args.symbolFilter,
        }));
        const brokerLegs = [...byId.values()].filter(r => r.broker_account_id === brokerId);
        if (brokerLegs.length > 0)
            continue;
        const { data: latestOpen } = await supabase
            .from('trades')
            .select('signal_id')
            .eq('user_id', userId)
            .eq('broker_account_id', brokerId)
            .eq('status', 'open')
            .not('metaapi_order_id', 'is', null)
            .order('opened_at', { ascending: false })
            .limit(5);
        for (const row of latestOpen ?? []) {
            const anchorId = row.signal_id;
            if (!anchorId)
                continue;
            const { data: sig } = await supabase
                .from('signals')
                .select('channel_id')
                .eq('id', anchorId)
                .maybeSingle();
            if (sig?.channel_id !== channelId)
                continue;
            const basket = await (0, managementScope_1.loadTradesForBasketAnchor)(supabase, {
                userId,
                brokerAccountIds: [brokerId],
                anchorSignalId: anchorId,
            });
            ingest(basket);
        }
    }
    return [...byId.values()].sort((a, b) => {
        const ta = a.opened_at ? new Date(a.opened_at).getTime() : 0;
        const tb = b.opened_at ? new Date(b.opened_at).getTime() : 0;
        return ta - tb;
    });
}
/** All open symbol buckets on a channel (channel-wide modify without symbol in text). */
function allChannelModifySymbolBuckets(trades) {
    if (!trades.length)
        return [];
    return trades;
}
function brokerOrderSlMatchesTarget(brokerSl, targetSl, tolerance = SL_VERIFY_TOLERANCE) {
    if (brokerSl == null || !(brokerSl > 0) || !(targetSl > 0))
        return false;
    return Math.abs(brokerSl - targetSl) <= tolerance;
}
async function fetchBrokerOrdersByTicket(api, uuid) {
    const map = new Map();
    try {
        const orders = await api.openedOrders(uuid);
        for (const raw of orders ?? []) {
            if (!raw || typeof raw !== 'object')
                continue;
            const o = raw;
            const ticket = Number(o.ticket ?? o.Ticket ?? o.orderId ?? o.OrderID ?? 0);
            if (Number.isFinite(ticket) && ticket > 0)
                map.set(ticket, raw);
        }
    }
    catch {
        /* caller falls back to ticket-set preflight only */
    }
    return map;
}
function verifyLegStopOnBroker(ordersByTicket, ticket, targetSl) {
    const raw = ordersByTicket.get(ticket);
    if (!raw)
        return false;
    const brokerSl = (0, signalEntryPendingHelpers_1.readBrokerOrderStopLoss)(raw);
    return brokerOrderSlMatchesTarget(brokerSl, targetSl);
}
async function resolveTargetSlForLeg(args) {
    const override = positiveNum(args.slOverride);
    if (override != null)
        return override;
    const parsedSl = positiveNum(args.parsedSl);
    if (args.slFrom === 'parsed' && parsedSl != null)
        return parsedSl;
    const tryChannel = async () => {
        if (!args.channelId)
            return null;
        const ch = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(args.supabase, args.userId, args.channelId, args.symbol);
        return positiveNum(ch?.stoploss);
    };
    if (args.slFrom === 'trade') {
        const fromTrade = positiveNum(args.tradeSl);
        if (fromTrade != null)
            return fromTrade;
        const fromCh = await tryChannel();
        if (fromCh != null)
            return fromCh;
        if (parsedSl != null)
            return parsedSl;
    }
    if (args.slFrom === 'signal') {
        if (parsedSl != null)
            return parsedSl;
        const fromCh = await tryChannel();
        if (fromCh != null)
            return fromCh;
    }
    const fromCh = await tryChannel();
    if (fromCh != null)
        return fromCh;
    if (parsedSl != null)
        return parsedSl;
    return positiveNum(args.tradeSl);
}
function legToBasketOpenLeg(leg) {
    return {
        id: leg.id,
        signal_id: leg.signal_id,
        metaapi_order_id: leg.metaapi_order_id,
        opened_at: leg.opened_at ?? '',
        lot_size: leg.lot_size ?? 0.01,
        sl: leg.sl,
        tp: leg.tp,
        entry_price: leg.entry_price,
        direction: leg.direction,
        symbol: leg.symbol,
    };
}
async function applyChannelStopsToBaskets(args) {
    const { supabase, apiFor, userId, channelId, signalId, brokersById, rowsByBrokerSignal, hasNewSl, hasNewTp, parsedSl, parsedTpLevels = [], dryRun = false, manualPush = false, verifyOnBroker = true, fxsocketOnly = false, } = args;
    const slOnly = args.slOnly === true || (hasNewSl && !hasNewTp);
    const tpOnly = args.tpOnly === true || (hasNewTp && !hasNewSl);
    const brokerResults = [];
    let totalModified = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    if (!dryRun && !(0, fxsocketClient_1.hasFxsocketConfigured)()) {
        return {
            brokers: [],
            allFullySynced: false,
            totalModified: 0,
            totalFailed: 0,
            totalSkipped: 0,
        };
    }
    for (const [basketKey, brokerRows] of rowsByBrokerSignal) {
        const brokerId = basketKey.split('|')[0];
        const broker = brokersById.get(brokerId);
        const uuid = broker ? (0, helpers_1.brokerSessionUuid)(broker) : null;
        const anchorSignalId = brokerRows[0]?.signal_id ?? '';
        const symbol = brokerRows[0]?.symbol ?? '';
        const direction = String(brokerRows[0]?.direction ?? '').toLowerCase().includes('sell')
            ? 'sell'
            : 'buy';
        const baseResult = {
            brokerId,
            anchorSignalId,
            symbol,
            direction,
            openLegs: 0,
            attempted: 0,
            modified: 0,
            failed: 0,
            skipped: 0,
            verified: 0,
            errors: [],
            fullySynced: false,
        };
        if (!broker || !uuid || uuid.includes('|')) {
            baseResult.skipped = brokerRows.length;
            baseResult.errors.push({
                tradeId: '',
                ticket: 0,
                message: 'no broker session',
                skipReason: 'no_session',
            });
            totalSkipped += brokerRows.length;
            brokerResults.push(baseResult);
            (0, workerMetrics_1.incMetric)('mgmt_modify_broker_skipped');
            continue;
        }
        if (fxsocketOnly && !(0, helpers_1.brokerHasLinkedSession)(broker)) {
            baseResult.skipped = brokerRows.length;
            baseResult.errors.push({
                tradeId: '',
                ticket: 0,
                message: 'not fxsocket-only broker',
                skipReason: 'fxsocket_only',
            });
            totalSkipped += brokerRows.length;
            brokerResults.push(baseResult);
            (0, workerMetrics_1.incMetric)('mgmt_modify_broker_skipped');
            continue;
        }
        const api = apiFor(broker);
        if (!api && !dryRun) {
            baseResult.failed = brokerRows.length;
            totalFailed += brokerRows.length;
            brokerResults.push(baseResult);
            continue;
        }
        api?.seedPlatformCache(uuid, (0, fxsocketClient_1.mtPlatformFrom)(broker.platform ?? 'mt5'));
        const legs = brokerRows
            .filter(r => {
            const ticket = Number(r.metaapi_order_id);
            return Number.isFinite(ticket) && ticket > 0;
        })
            .sort((a, b) => {
            const ta = a.opened_at ? new Date(a.opened_at).getTime() : 0;
            const tb = b.opened_at ? new Date(b.opened_at).getTime() : 0;
            return ta - tb;
        });
        baseResult.openLegs = legs.length;
        if (!legs.length) {
            brokerResults.push(baseResult);
            continue;
        }
        const tpLots = broker.manual_settings?.tp_lots ?? null;
        const isBuy = direction === 'buy';
        const tpMap = slOnly || tpOnly
            ? new Map()
            : (0, tpBucketDistribution_1.buildEntryQualityTakeProfitMap)({
                legs: legs.map(tr => ({
                    id: tr.id,
                    entryPrice: Number(tr.entry_price ?? 0),
                    openedAt: tr.opened_at ?? '',
                })),
                isBuy,
                slotLegCount: legs.length,
                finalTps: parsedTpLevels,
                tpLots: tpLots ?? null,
            });
        let openedTickets = null;
        let ordersByTicket = new Map();
        if (api) {
            try {
                openedTickets = await (0, basketSlTpReconcile_1.fetchOpenBrokerTickets)(api, uuid);
                if (verifyOnBroker) {
                    ordersByTicket = await fetchBrokerOrdersByTicket(api, uuid);
                }
            }
            catch {
                openedTickets = null;
            }
        }
        const slCache = new Map();
        const perLegTargets = [];
        for (let i = 0; i < legs.length; i++) {
            const tr = legs[i];
            baseResult.attempted += 1;
            const ticket = Number(tr.metaapi_order_id);
            const keepTp = positiveNum(tr.tp);
            const keepSl = positiveNum(tr.sl);
            const targetTp = tpOnly
                ? (tpMap.get(tr.id) ?? keepTp)
                : slOnly
                    ? keepTp
                    : (tpMap.get(tr.id) ?? keepTp);
            let targetSl = tpOnly ? keepSl : null;
            if (!tpOnly && hasNewSl) {
                const chKey = `${tr.telegram_channel_id ?? channelId ?? ''}|${tr.symbol}`;
                const cached = slCache.get(chKey);
                if (cached != null) {
                    targetSl = cached;
                }
                else {
                    targetSl = await resolveTargetSlForLeg({
                        supabase,
                        userId,
                        channelId: tr.telegram_channel_id ?? channelId,
                        symbol: tr.symbol,
                        parsedSl,
                        slOverride: args.slOverride,
                        slFrom: args.slFrom ?? 'parsed',
                        tradeSl: tr.sl,
                    });
                    if (targetSl != null)
                        slCache.set(chKey, targetSl);
                }
            }
            if (targetSl != null && targetSl > 0) {
                perLegTargets.push({
                    stoploss: targetSl,
                    takeprofit: targetTp ?? 0,
                });
            }
            else if (targetTp != null && targetTp > 0) {
                perLegTargets.push({ stoploss: keepSl ?? 0, takeprofit: targetTp });
            }
            else {
                baseResult.skipped += 1;
                totalSkipped += 1;
                continue;
            }
            const target = perLegTargets[perLegTargets.length - 1];
            if (!tpOnly
                && target.stoploss > 0
                && (0, orderModifyBenign_1.stopsAlreadyMatchDb)({ sl: tr.sl, tp: tr.tp }, { stoploss: target.stoploss, takeprofit: target.takeprofit ?? 0 }, 0, i)
                && (!verifyOnBroker || verifyLegStopOnBroker(ordersByTicket, ticket, target.stoploss))) {
                baseResult.skipped += 1;
                baseResult.verified += 1;
                totalSkipped += 1;
                continue;
            }
            if (openedTickets && openedTickets.size > 0 && !openedTickets.has(ticket)) {
                baseResult.skipped += 1;
                baseResult.errors.push({
                    tradeId: tr.id,
                    ticket,
                    message: 'ticket not in OpenedOrders',
                    skipReason: 'skipped_not_on_broker',
                });
                totalSkipped += 1;
                continue;
            }
            if (dryRun)
                continue;
            try {
                const modifyArgs = { ticket };
                if (!tpOnly && target.stoploss > 0)
                    modifyArgs.stoploss = target.stoploss;
                if (!slOnly && target.takeprofit > 0)
                    modifyArgs.takeprofit = target.takeprofit;
                if (modifyArgs.stoploss == null && modifyArgs.takeprofit == null) {
                    baseResult.skipped += 1;
                    totalSkipped += 1;
                    continue;
                }
                await api.orderModify(uuid, modifyArgs);
                const brokerOk = !verifyOnBroker
                    || !hasNewSl
                    || target.stoploss <= 0
                    || verifyLegStopOnBroker(ordersByTicket, ticket, target.stoploss);
                if (!brokerOk) {
                    baseResult.failed += 1;
                    totalFailed += 1;
                    baseResult.errors.push({
                        tradeId: tr.id,
                        ticket,
                        message: 'broker SL mismatch after OrderModify',
                        skipReason: 'broker_verify_failed',
                    });
                    continue;
                }
                const dbPatch = {};
                if (!tpOnly && target.stoploss > 0)
                    dbPatch.sl = target.stoploss;
                if (!slOnly && target.takeprofit > 0)
                    dbPatch.tp = target.takeprofit;
                if (Object.keys(dbPatch).length > 0) {
                    await supabase.from('trades').update(dbPatch).eq('id', tr.id);
                }
                await supabase.from('trade_execution_logs').insert({
                    user_id: userId,
                    signal_id: signalId,
                    broker_account_id: brokerId,
                    action: 'mgmt_modify',
                    status: 'success',
                    request_payload: {
                        ticket,
                        action: 'modify',
                        target_sl: modifyArgs.stoploss ?? null,
                        target_tp: modifyArgs.takeprofit ?? null,
                        manual_push: manualPush,
                        trade_id: tr.id,
                        channel_stop_apply: true,
                    },
                });
                baseResult.modified += 1;
                baseResult.verified += 1;
                totalModified += 1;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if ((0, orderModifyBenign_1.isBenignOrderModifyError)(msg)) {
                    baseResult.skipped += 1;
                    totalSkipped += 1;
                    continue;
                }
                baseResult.failed += 1;
                totalFailed += 1;
                baseResult.errors.push({ tradeId: tr.id, ticket, message: msg });
                try {
                    await supabase.from('trade_execution_logs').insert({
                        user_id: userId,
                        signal_id: signalId,
                        broker_account_id: brokerId,
                        action: 'mgmt_modify',
                        status: 'failed',
                        error_message: msg,
                        request_payload: { ticket, trade_id: tr.id, channel_stop_apply: true },
                    });
                }
                catch { /* best-effort */ }
            }
        }
        baseResult.fullySynced = baseResult.openLegs > 0
            && baseResult.failed === 0
            && baseResult.modified + baseResult.verified >= baseResult.openLegs;
        if (!baseResult.fullySynced && baseResult.openLegs > 0) {
            (0, workerMetrics_1.incMetric)('mgmt_modify_partial');
            const familyTrades = legs.map(legToBasketOpenLeg);
            await (0, basketSlTpReconcile_1.upsertBasketReconcileJob)(supabase, {
                userId,
                brokerAccountId: brokerId,
                anchorSignalId,
                sourceSignalId: signalId,
                channelId,
                symbol,
                direction,
                perLegTargets: perLegTargets.length
                    ? perLegTargets
                    : familyTrades.map(tr => ({
                        stoploss: positiveNum(parsedSl) ?? positiveNum(tr.sl) ?? 0,
                        takeprofit: positiveNum(tr.tp) ?? 0,
                    })),
                familyTrades,
                signalTps: parsedTpLevels,
                tpLots,
                virtualPendingsSnapshot: null,
                nImmCwe: 0,
                overrideTp: null,
                lastError: `channel_stop_apply partial ${baseResult.modified}/${baseResult.openLegs}`,
            });
        }
        brokerResults.push(baseResult);
    }
    const allFullySynced = brokerResults.length > 0
        && brokerResults.every(r => r.openLegs === 0 || r.fullySynced);
    return {
        brokers: brokerResults,
        allFullySynced,
        totalModified,
        totalFailed,
        totalSkipped,
    };
}
async function logMgmtModifyBrokerSummaries(supabase, userId, signalId, results) {
    for (const r of results) {
        if (r.openLegs === 0)
            continue;
        try {
            await supabase.from('trade_execution_logs').insert({
                user_id: userId,
                signal_id: signalId,
                broker_account_id: r.brokerId,
                action: 'mgmt_modify_broker_summary',
                status: r.fullySynced ? 'success' : 'failed',
                request_payload: {
                    anchor_signal_id: r.anchorSignalId,
                    symbol: r.symbol,
                    open_legs: r.openLegs,
                    attempted: r.attempted,
                    modified: r.modified,
                    failed: r.failed,
                    skipped: r.skipped,
                    verified: r.verified,
                    fully_synced: r.fullySynced,
                    skip_reasons: r.errors.map(e => e.skipReason ?? e.message),
                },
            });
        }
        catch { /* best-effort */ }
    }
}
function mgmtRowsToStopLegs(rows) {
    return rows.map(mgmtRowToLeg);
}
async function expandAndGroupChannelModifyLegs(supabase, userId, rows) {
    const expanded = await (0, managementScope_1.expandMgmtRowsToFullBaskets)(supabase, { userId, rows });
    return groupLegsByBrokerSignal(mgmtRowsToStopLegs(expanded));
}
