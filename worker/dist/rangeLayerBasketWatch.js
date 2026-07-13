"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchRangeLayeringBasketEvents = watchRangeLayeringBasketEvents;
const virtualPendingMonitor_1 = require("./virtualPendingMonitor");
const rangeLayerTillClose_1 = require("./rangeLayerTillClose");
const rangePendingFireGuard_1 = require("./rangePendingFireGuard");
/**
 * Detect TP-touch / partial basket close and stop range layering when layer-till-close is OFF.
 * Shared by virtual and broker-pending range monitors.
 */
async function watchRangeLayeringBasketEvents(supabase, args) {
    const touched = new Set();
    const { signalIds, brokerIds, symbol, bid, ask, logAction = 'range_layering_stopped' } = args;
    if (!signalIds.length || !brokerIds.length || !symbol)
        return touched;
    const { data, error } = await supabase
        .from('trades')
        .select('signal_id,broker_account_id,user_id,direction,tp,status')
        .in('signal_id', signalIds)
        .in('broker_account_id', brokerIds)
        .eq('symbol', symbol)
        .in('status', ['open', 'closed']);
    if (error) {
        console.warn(`[rangeLayerBasketWatch] tp-touch scan failed: ${error.message}`);
        return touched;
    }
    const byBasket = new Map();
    for (const row of (data ?? [])) {
        const basketKey = `${row.signal_id}|${row.broker_account_id}`;
        const arr = byBasket.get(basketKey) ?? [];
        arr.push(row);
        byBasket.set(basketKey, arr);
    }
    for (const [basketKey, rows] of byBasket) {
        const openRows = rows.filter(r => r.status === 'open');
        const closedCount = rows.length - openRows.length;
        const direction = String((openRows[0] ?? rows[0])?.direction ?? '').toLowerCase();
        const openTps = openRows
            .map(r => Number(r.tp))
            .filter(tp => Number.isFinite(tp) && tp > 0);
        const decision = (0, virtualPendingMonitor_1.shouldLockBasketLayering)({
            direction,
            openTps,
            openCount: openRows.length,
            closedCount,
            bid,
            ask,
        });
        if (!decision.lock)
            continue;
        const [signalId, brokerAccountId] = basketKey.split('|');
        if (!signalId || !brokerAccountId)
            continue;
        const userId = (openRows[0] ?? rows[0])?.user_id;
        if (!userId)
            continue;
        const layerTillClose = await (0, rangeLayerTillClose_1.loadRangeLayerTillCloseForSignal)(supabase, signalId, brokerAccountId);
        if (layerTillClose) {
            await (0, rangePendingFireGuard_1.setTpTouchedLock)(supabase, {
                signalId,
                brokerAccountId,
                symbol,
                userId,
                lockReason: decision.reason ?? 'tp_touched',
                triggerPrice: decision.triggerPrice ?? null,
                triggerSide: decision.triggerSide ?? null,
            });
            continue;
        }
        const { stopped, deleted } = await (0, rangeLayerTillClose_1.stopRangeLayeringUnlessEnabled)(supabase, { signalId, brokerAccountId, symbol, userId }, decision.reason ?? 'tp_touched');
        if (!stopped)
            continue;
        touched.add(basketKey);
        try {
            await supabase.from('trade_execution_logs').insert({
                user_id: userId,
                signal_id: signalId,
                broker_account_id: brokerAccountId,
                action: logAction,
                status: 'info',
                request_payload: {
                    symbol,
                    direction,
                    trigger_price: decision.triggerPrice,
                    trigger_side: decision.triggerSide,
                    lock_trigger: decision.reason,
                    closed_trades: closedCount,
                    open_trades: openRows.length,
                    bid,
                    ask,
                    deleted_rows: deleted,
                    lock_reason: 'layering_stopped',
                },
            });
        }
        catch { /* best-effort */ }
    }
    return touched;
}
