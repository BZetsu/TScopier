"use strict";
/**
 * Apply channel management "modify" (Adjust SL/TP) across multi-leg baskets with
 * per-leg broker validation, clamping, and reconcile retries for missed legs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMgmtModifyToBasketGroups = applyMgmtModifyToBasketGroups;
const fxsocketClient_1 = require("./fxsocketClient");
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const tpBucketDistribution_1 = require("./manualPlanning/tpBucketDistribution");
const channelMessageFilters_1 = require("./channelMessageFilters");
const helpers_1 = require("./tradeExecutor/helpers");
function sanitizeLevel(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
function mgmtRowToBasketLeg(row) {
    return {
        id: row.id,
        signal_id: row.signal_id,
        metaapi_order_id: row.metaapi_order_id,
        opened_at: row.opened_at ?? '',
        lot_size: row.lot_size,
        sl: row.sl,
        tp: row.tp,
        entry_price: row.entry_price,
        direction: row.direction,
        symbol: row.symbol,
    };
}
function inferBasketDirection(rows) {
    const sample = String(rows[0]?.direction ?? '').toLowerCase();
    return sample.includes('sell') ? 'sell' : 'buy';
}
function buildMgmtModifyTargets(args) {
    const { familyTrades, hasNewSl, newSl, hasNewTp, parsedTpLevels, multiBasket, tpLots, } = args;
    return familyTrades.map((tr, legIndex) => {
        const stoploss = hasNewSl ? newSl : sanitizeLevel(tr.sl);
        let takeprofit = sanitizeLevel(tr.tp);
        if (hasNewTp) {
            if (multiBasket) {
                const distributed = (0, tpBucketDistribution_1.takeProfitForLegIndex)({
                    legIndex,
                    openLegCount: familyTrades.length,
                    finalTps: parsedTpLevels,
                    tpLots,
                });
                if (distributed > 0)
                    takeprofit = distributed;
            }
            else {
                takeprofit = parsedTpLevels[0] ?? takeprofit;
            }
        }
        return { stoploss, takeprofit };
    });
}
async function applyMgmtModifyToBasketGroups(args) {
    const { supabase, apiFor, signal, parsed, rowsByBrokerSignal, brokersById, hasNewSl, hasNewTp, parsedTpLevels, liveMgmtFast, } = args;
    if (!hasNewSl && !hasNewTp)
        return { allSynced: true };
    const newSl = hasNewSl ? parsed.sl : 0;
    let allSynced = true;
    for (const [basketKey, brokerRows] of rowsByBrokerSignal) {
        const broker = brokersById.get(basketKey.split('|')[0]);
        if (!broker)
            continue;
        const uuid = (0, helpers_1.brokerSessionUuid)(broker);
        if (!uuid || uuid.includes('|'))
            continue;
        if ((0, channelMessageFilters_1.isChannelManagementBlocked)((0, channelMessageFilters_1.normalizeChannelMessageFiltersMap)(broker.channel_message_filters), signal.channel_id, 'modify', { hasNewSl, hasNewTp })) {
            continue;
        }
        const api = apiFor(broker);
        if (!api)
            continue;
        const familyTrades = brokerRows
            .filter(r => {
            const ticket = Number(r.metaapi_order_id);
            return Number.isFinite(ticket) && ticket > 0;
        })
            .sort((a, b) => {
            const ta = a.opened_at ? new Date(a.opened_at).getTime() : 0;
            const tb = b.opened_at ? new Date(b.opened_at).getTime() : 0;
            return ta - tb;
        })
            .map(mgmtRowToBasketLeg);
        if (!familyTrades.length)
            continue;
        const anchorSignalId = familyTrades[0].signal_id;
        const symbol = familyTrades[0].symbol;
        const direction = inferBasketDirection(brokerRows);
        const manual = (broker.manual_settings ?? {});
        const multiBasket = manual.trade_style === 'multi'
            && familyTrades.length > 1
            && parsedTpLevels.length >= 2;
        let params = null;
        try {
            const sp = await api.symbolParams(uuid, symbol);
            const n = (0, fxsocketClient_1.normalizeSymbolParams)(sp);
            params = {
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
            // optional — runBasketLegModifies still attempts modify
        }
        let openedTickets = null;
        try {
            openedTickets = await (0, basketSlTpReconcile_1.fetchOpenBrokerTickets)(api, uuid);
        }
        catch {
            openedTickets = null;
        }
        const perLegTargets = buildMgmtModifyTargets({
            familyTrades,
            hasNewSl,
            newSl,
            hasNewTp,
            parsedTpLevels,
            multiBasket,
            tpLots: manual.tp_lots,
        });
        const nImmCwe = brokerRows.filter(r => r.cwe_close_price != null).length;
        const overrideTp = brokerRows.find(r => r.cwe_close_price != null)?.cwe_close_price ?? null;
        const result = await (0, basketSlTpReconcile_1.applyBasketLegSync)({
            supabase,
            api,
            uuid,
            symbol,
            direction,
            baseLot: Number(broker.default_lot_size ?? 0.01),
            params,
            signalId: signal.id,
            userId: signal.user_id,
            brokerAccountId: broker.id,
            channelId: signal.channel_id,
            anchorSignalId,
            familyTrades,
            perLegTargets,
            signalTps: parsedTpLevels,
            tpLots: manual.tp_lots,
            nImmCwe,
            overrideTp: typeof overrideTp === 'number' ? overrideTp : null,
            openedTickets,
            liveMgmtFast,
            orderCommentsEnabled: manual.order_comments_enabled !== false,
            explicitChannelTargets: true,
        });
        if (result.mergeFailed) {
            allSynced = false;
            console.warn(`[tradeExecutor] mgmt modify partial broker=${broker.id} anchor=${anchorSignalId}:`
                + ` ${result.summary.modified}/${result.summary.openLegs} legs`
                + (result.reconcileEnqueued ? ' (reconcile job enqueued)' : ''));
        }
    }
    return { allSynced };
}
