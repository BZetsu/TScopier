"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RangeBrokerPendingMonitor = void 0;
const fxsocketClient_1 = require("./fxsocketClient");
const mtApiByAccount_1 = require("./mtApiByAccount");
const autoManagement_1 = require("./autoManagement");
const basketModFollowUp_1 = require("./basketModFollowUp");
const normalizeManualSettings_1 = require("./manualPlanning/normalizeManualSettings");
const channelTradingConfig_1 = require("./channelTradingConfig");
const rangePendingLadderSync_1 = require("./rangePendingLadderSync");
const rangeBasketTpSync_1 = require("./rangeBasketTpSync");
const monitorIdleGate_1 = require("./monitorIdleGate");
const copierPause_1 = require("./copierPause");
const signalEntryPendingHelpers_1 = require("./signalEntryPendingHelpers");
const rangeBrokerPendingHelpers_1 = require("./rangeBrokerPendingHelpers");
const rangeLayerBasketWatch_1 = require("./rangeLayerBasketWatch");
const ACTIVE_MS = (0, monitorIdleGate_1.monitorActiveIntervalMs)('RANGE_BROKER_PENDING_TICK_MS', 2000);
const IDLE_MS = (0, monitorIdleGate_1.monitorIdleIntervalMs)('RANGE_BROKER_PENDING_IDLE_MS', 15000);
const MISSING_BEFORE_ASSUME_GONE = 6;
function extractOpenPrice(raw) {
    const num = (v) => {
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v === 'string' && v.trim()) {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        }
        return undefined;
    };
    const px = num(raw.openPrice ?? raw.OpenPrice ?? raw.price ?? raw.Price ?? raw.priceOpen ?? raw.PriceOpen);
    return px != null && px > 0 ? px : null;
}
async function loadManualForLeg(supabase, brokerAccountId, channelId) {
    const { data, error } = await supabase
        .from('broker_accounts')
        .select('manual_settings,channel_trading_configs,copier_mode,signal_channel_ids')
        .eq('id', brokerAccountId)
        .maybeSingle();
    if (error || !data)
        return {};
    const resolved = (0, channelTradingConfig_1.resolveChannelTradingConfig)(data, channelId);
    return (resolved?.manual_settings ?? {});
}
async function rebalanceAfterFill(supabase, platformByUuid, leg, channelId) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return;
    const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(platformByUuid, leg.metaapi_account_id);
    if (!api)
        return;
    const { data: signalRow } = await supabase
        .from('signals')
        .select('parsed_data, channel_id, created_at')
        .eq('id', leg.signal_id)
        .maybeSingle();
    const rawManual = await loadManualForLeg(supabase, leg.broker_account_id, channelId ?? signalRow?.channel_id);
    const manual = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(rawManual);
    if (manual.range_trading !== true)
        return;
    let rawParams = null;
    try {
        rawParams = await api.symbolParams(leg.metaapi_account_id, leg.symbol);
    }
    catch { /* optional */ }
    const params = rawParams ? (0, fxsocketClient_1.normalizeSymbolParams)(rawParams) : null;
    const parsed = (0, rangeBasketTpSync_1.toRangeBasketParsedSlice)((signalRow?.parsed_data ?? null));
    await (0, rangeBasketTpSync_1.syncRangeBasketTakeProfits)({
        supabase,
        api,
        uuid: leg.metaapi_account_id,
        symbol: leg.symbol,
        direction: leg.is_buy ? 'buy' : 'sell',
        baseLot: 0.01,
        params: params
            ? {
                digits: params.digits ?? 5,
                point: params.point ?? 0.00001,
                minLot: params.minLot ?? 0.01,
                lotStep: params.lotStep ?? 0.01,
                contractSize: Number.isFinite(params.contractSize) && (params.contractSize ?? 0) > 0
                    ? Number(params.contractSize)
                    : 100000,
                stopsLevel: Math.max(0, params.stopsLevel ?? 0),
                freezeLevel: Math.max(0, params.freezeLevel ?? 0),
            }
            : null,
        signalId: leg.signal_id,
        userId: leg.user_id,
        brokerAccountId: leg.broker_account_id,
        manual,
        parsed,
        forceLayeringRebalance: true,
        channelId: channelId ?? signalRow?.channel_id,
        basketCreatedAt: (signalRow?.created_at ?? null),
    });
}
async function markBrokerRangeLegFilled(supabase, platformByUuid, leg, fillPrice, positionTicket) {
    const { data: signalRow } = await supabase
        .from('signals')
        .select('channel_id')
        .eq('id', leg.signal_id)
        .maybeSingle();
    const channelId = (signalRow?.channel_id ?? null);
    const entryPx = Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : leg.trigger_price;
    const openSl = leg.stoploss;
    const rawManual = await loadManualForLeg(supabase, leg.broker_account_id, channelId);
    const manual = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(rawManual);
    const autoBeCols = (0, autoManagement_1.autoManagementTradeSnapshot)(manual, entryPx, openSl);
    const ticketForTrade = positionTicket?.trim() && /^\d+$/.test(positionTicket.trim())
        ? positionTicket.trim()
        : (leg.ticket ?? null);
    await (0, rangePendingLadderSync_1.markRangeLegFired)(supabase, leg.id, ticketForTrade);
    const { data: insTrade, error: insErr } = await supabase.from('trades').insert({
        user_id: leg.user_id,
        signal_id: leg.signal_id,
        telegram_channel_id: channelId,
        broker_account_id: leg.broker_account_id,
        metaapi_order_id: ticketForTrade,
        symbol: leg.symbol,
        direction: leg.is_buy ? 'buy' : 'sell',
        entry_price: entryPx,
        sl: openSl,
        tp: leg.cwe_close_price != null ? null : leg.takeprofit,
        lot_size: leg.volume,
        status: 'open',
        opened_at: new Date().toISOString(),
        cwe_close_price: leg.cwe_close_price ?? null,
        ...autoBeCols,
    }).select('id').maybeSingle();
    if (insErr) {
        console.warn(`[rangeBrokerPending] trades insert failed leg=${leg.id}: ${insErr.message}`);
        return;
    }
    const tradeRowId = insTrade?.id ?? null;
    const ticketNum = ticketForTrade != null ? Number(ticketForTrade) : NaN;
    const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(platformByUuid, leg.metaapi_account_id);
    if (tradeRowId && api && Number.isFinite(ticketNum) && ticketNum > 0) {
        try {
            await (0, basketModFollowUp_1.tryApplyBasketFollowUpToNewFill)(supabase, api, {
                userId: leg.user_id,
                basketSignalId: leg.signal_id,
                brokerAccountId: leg.broker_account_id,
                metaUuid: leg.metaapi_account_id,
                symbol: leg.symbol,
                ticket: ticketNum,
                tradeRowId,
                entryPrice: entryPx,
                existingSl: openSl,
                existingTp: leg.takeprofit,
                isBuy: leg.is_buy,
            });
        }
        catch (hookErr) {
            console.warn(`[rangeBrokerPending] SL/TP follow-up leg=${leg.id}:`, hookErr);
        }
        await new Promise(r => setTimeout(r, Number(process.env.RANGE_REBALANCE_SETTLE_MS ?? 150)));
        try {
            await rebalanceAfterFill(supabase, platformByUuid, leg, channelId);
        }
        catch (rebalErr) {
            console.warn(`[rangeBrokerPending] TP rebalance leg=${leg.id}:`, rebalErr);
        }
    }
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: leg.user_id,
            signal_id: leg.signal_id,
            broker_account_id: leg.broker_account_id,
            action: 'range_broker_pending_fired',
            status: 'success',
            request_payload: {
                leg_id: leg.id,
                step_idx: leg.step_idx,
                trigger_price: leg.trigger_price,
                fill_price: entryPx,
                ticket: ticketForTrade,
            },
        });
    }
    catch { /* best-effort */ }
}
/**
 * Polls broker limit orders for range layering (Pending Order mode): detects fills,
 * expiry, and manual deletes on `range_pending_legs` rows with status `broker_pending`.
 */
class RangeBrokerPendingMonitor {
    constructor(supabase) {
        this.supabase = supabase;
        this.loop = null;
        this.platformByUuid = new Map();
        this.ticking = false;
        this.missingStreak = new Map();
    }
    start() {
        if (this.loop)
            return;
        if (!(0, fxsocketClient_1.hasFxsocketConfigured)()) {
            console.warn('[rangeBrokerPendingMonitor] MT4API_BASIC_USER/PASSWORD missing — monitor disabled');
            return;
        }
        this.loop = (0, monitorIdleGate_1.startMonitorLoop)({
            name: 'rangeBrokerPendingMonitor',
            supabase: this.supabase,
            activeIntervalMs: ACTIVE_MS,
            idleIntervalMs: IDLE_MS,
            hasWork: sb => (0, monitorIdleGate_1.hasWorkOnShard)(sb, 'range_pending_legs', q => q.eq('status', 'broker_pending')),
            tick: () => this.runTick(),
        });
        console.log(`[rangeBrokerPendingMonitor] started active=${ACTIVE_MS}ms idle=${IDLE_MS}ms`);
    }
    stop() {
        this.loop?.stop();
        this.loop = null;
    }
    getLoopHandle() {
        return this.loop;
    }
    async runTick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            await this.tick();
        }
        finally {
            this.ticking = false;
        }
    }
    async tick() {
        if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
            return;
        const rowsQ = await (0, monitorIdleGate_1.applyShardToQuery)(this.supabase, this.supabase
            .from('range_pending_legs')
            .select('id,signal_id,user_id,broker_account_id,metaapi_account_id,symbol,step_idx,is_buy,volume,trigger_price,stoploss,takeprofit,slippage,comment,expert_id,ticket,expires_at,cwe_close_price')
            .eq('status', 'broker_pending')
            .limit(200));
        if (!rowsQ)
            return;
        const { data, error } = await rowsQ;
        if (error) {
            console.error('[rangeBrokerPendingMonitor] select failed:', error.message);
            return;
        }
        const rows = (data ?? [])
            .filter(r => !(0, copierPause_1.isUserCopierPausedCached)(r.user_id));
        const { data: cancelRows } = await this.supabase
            .from('range_pending_legs')
            .select('metaapi_account_id')
            .eq('status', 'cancelled')
            .eq('error_message', 'basket_empty')
            .not('ticket', 'is', null)
            .limit(100);
        const accountIds = [
            ...rows.map(r => r.metaapi_account_id),
            ...(cancelRows ?? []).map(r => r.metaapi_account_id),
        ];
        this.platformByUuid = await (0, mtApiByAccount_1.loadPlatformByFxsocketId)(this.supabase, accountIds);
        await (0, rangeBrokerPendingHelpers_1.reconcileBasketEmptyCancelledLegs)(this.supabase, uuid => (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid));
        if (!rows.length) {
            this.missingStreak.clear();
            return;
        }
        const nowMs = Date.now();
        const expiredRows = rows.filter(r => {
            if (!r.expires_at)
                return false;
            const t = Date.parse(r.expires_at);
            return Number.isFinite(t) && t <= nowMs;
        });
        const watchRows = rows.filter(r => !expiredRows.includes(r));
        for (const row of expiredRows) {
            const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, row.metaapi_account_id);
            if (api)
                await (0, rangeBrokerPendingHelpers_1.cancelBrokerRangeLegAtBroker)(this.supabase, api, row, 'expired');
            else {
                await this.supabase
                    .from('range_pending_legs')
                    .update({ status: 'expired', error_message: 'pending_expiry' })
                    .eq('id', row.id)
                    .eq('status', 'broker_pending');
            }
        }
        const quoteGroups = new Map();
        for (const r of watchRows) {
            const k = `${r.metaapi_account_id}|${r.symbol}`;
            const list = quoteGroups.get(k) ?? [];
            list.push(r);
            quoteGroups.set(k, list);
        }
        for (const [key, group] of quoteGroups) {
            const [uuid, symbol] = key.split('|');
            if (!uuid || !symbol)
                continue;
            const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid);
            if (!api)
                continue;
            try {
                const q = await api.quote(uuid, symbol);
                await (0, rangeLayerBasketWatch_1.watchRangeLayeringBasketEvents)(this.supabase, {
                    signalIds: [...new Set(group.map(r => r.signal_id))],
                    brokerIds: [...new Set(group.map(r => r.broker_account_id))],
                    symbol,
                    bid: q.bid,
                    ask: q.ask,
                    logAction: 'range_broker_pending_tp_lock',
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[rangeBrokerPendingMonitor] basket watch quote failed ${symbol}: ${msg}`);
            }
        }
        const byAccount = new Map();
        for (const r of watchRows) {
            const list = byAccount.get(r.metaapi_account_id) ?? [];
            list.push(r);
            byAccount.set(r.metaapi_account_id, list);
        }
        for (const [uuid, group] of byAccount) {
            const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid);
            if (!api)
                continue;
            let opened = [];
            try {
                opened = await api.openedOrders(uuid);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[rangeBrokerPendingMonitor] /OpenedOrders failed account=${uuid}: ${msg}`);
                continue;
            }
            const needClosed = [];
            for (const row of group) {
                const ticket = Number(row.ticket);
                if (!Number.isFinite(ticket) || ticket <= 0)
                    continue;
                const hit = (0, signalEntryPendingHelpers_1.findOpenedRowByTicket)(opened, ticket);
                if (hit) {
                    if ((0, signalEntryPendingHelpers_1.isPendingEntryRow)(hit)) {
                        this.missingStreak.delete(row.id);
                        continue;
                    }
                    if (!(0, signalEntryPendingHelpers_1.isLikelyMarketPositionRow)(hit)) {
                        this.missingStreak.delete(row.id);
                        continue;
                    }
                    const px = extractOpenPrice(hit);
                    if (px != null) {
                        this.missingStreak.delete(row.id);
                        const posTicket = (0, signalEntryPendingHelpers_1.rawOrderTicket)(hit);
                        await markBrokerRangeLegFilled(this.supabase, this.platformByUuid, row, px, posTicket > 0 ? String(posTicket) : null);
                        continue;
                    }
                }
                needClosed.push(row);
            }
            let closed = [];
            if (needClosed.length) {
                try {
                    closed = await api.closedOrders(uuid);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn(`[rangeBrokerPendingMonitor] /ClosedOrders failed account=${uuid}: ${msg}`);
                }
            }
            for (const row of needClosed) {
                const ticket = Number(row.ticket);
                if (!Number.isFinite(ticket) || ticket <= 0)
                    continue;
                const closedHit = (0, signalEntryPendingHelpers_1.findClosedRowForTicket)(closed, ticket);
                if (closedHit) {
                    this.missingStreak.delete(row.id);
                    const px = extractOpenPrice(closedHit) ?? row.trigger_price;
                    await markBrokerRangeLegFilled(this.supabase, this.platformByUuid, row, px, String(ticket));
                    continue;
                }
                const streak = (this.missingStreak.get(row.id) ?? 0) + 1;
                this.missingStreak.set(row.id, streak);
                if (streak >= MISSING_BEFORE_ASSUME_GONE) {
                    this.missingStreak.delete(row.id);
                    await this.supabase
                        .from('range_pending_legs')
                        .update({ status: 'cancelled', error_message: 'broker_missing' })
                        .eq('id', row.id)
                        .eq('status', 'broker_pending');
                }
            }
        }
    }
}
exports.RangeBrokerPendingMonitor = RangeBrokerPendingMonitor;
