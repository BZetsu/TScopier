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
const layeringPlanPersistence_1 = require("./manualPlanning/layeringPlanPersistence");
const layeringModeRollout_1 = require("./manualPlanning/layeringModeRollout");
const layeringPlanLifecycle_1 = require("./layeringPlanLifecycle");
const layeringModeBrokerPendingRecovery_1 = require("./tradeExecutor/layeringModeBrokerPendingRecovery");
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
    const desiredSl = leg.stoploss != null && Number(leg.stoploss) > 0 ? Number(leg.stoploss) : null;
    const isCwe = leg.cwe_close_price != null;
    const rawManual = await loadManualForLeg(supabase, leg.broker_account_id, channelId);
    const manual = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(rawManual);
    // Broker fill is naked (limits placed with SL=0/TP=0). Seed auto-BE from desired SL.
    const autoBeCols = (0, autoManagement_1.autoManagementTradeSnapshot)(manual, entryPx, desiredSl);
    const ticketForTrade = positionTicket?.trim() && /^\d+$/.test(positionTicket.trim())
        ? positionTicket.trim()
        : (leg.ticket ?? null);
    await (0, rangePendingLadderSync_1.markRangeLegFired)(supabase, leg.id, ticketForTrade);
    if (leg.layer_plan_id) {
        await (0, layeringPlanLifecycle_1.convergeLayeringPlanAfterLegTerminal)(supabase, leg.layer_plan_id);
    }
    // Insert trade as naked on broker so skipAlreadySynced cannot skip OrderModify
    // when DB already held intended stops from the pending row.
    const { data: insTrade, error: insErr } = await supabase.from('trades').insert({
        user_id: leg.user_id,
        signal_id: leg.signal_id,
        telegram_channel_id: channelId,
        broker_account_id: leg.broker_account_id,
        metaapi_order_id: ticketForTrade,
        symbol: leg.symbol,
        direction: leg.is_buy ? 'buy' : 'sell',
        entry_price: entryPx,
        sl: null,
        tp: null,
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
                // Broker position is naked — force follow-up OrderModify vs existing 0/0.
                existingSl: null,
                existingTp: null,
                tpLots: manual.tp_lots,
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
                naked_fill: true,
                desired_sl: desiredSl,
                cwe: isCwe,
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
        void this.runTick();
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
            .select('id,signal_id,user_id,broker_account_id,metaapi_account_id,symbol,step_idx,is_buy,volume,trigger_price,stoploss,takeprofit,slippage,comment,expert_id,ticket,expires_at,cwe_close_price,layer_plan_id,layer_plan_metadata,broker_client_reference,broker_pending_type,native_submission_status,submitted_at,confirmed_at,last_reconciled_at,broker_pending_reason')
            .eq('status', 'broker_pending')
            .limit(200));
        if (!rowsQ)
            return;
        const { data, error } = await rowsQ;
        if (error) {
            console.error('[rangeBrokerPendingMonitor] select failed:', error.message);
            return;
        }
        const candidateRows = (data ?? [])
            .filter(r => !(0, copierPause_1.isUserCopierPausedCached)(r.user_id));
        const rows = [];
        for (const row of candidateRows) {
            if (await this.layeringModeBrokerPendingAllowed(row))
                rows.push(row);
        }
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
        await (0, layeringModeBrokerPendingRecovery_1.recoverNativeLayeringSubmissions)({
            supabase: this.supabase,
            apiLookup: uuid => (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid),
        });
        await (0, layeringPlanLifecycle_1.recoverCancellingLayeringPlans)(this.supabase, {
            apiLookup: uuid => (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid),
        });
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
            if (row.layer_plan_id) {
                await (0, layeringPlanLifecycle_1.convergeLayeringPlanAfterLegTerminal)(this.supabase, row.layer_plan_id);
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
            let opened;
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
                    if (row.layer_plan_id) {
                        await (0, layeringPlanLifecycle_1.convergeLayeringPlanAfterLegTerminal)(this.supabase, row.layer_plan_id);
                    }
                }
            }
        }
    }
    async layeringModeBrokerPendingAllowed(row) {
        if (!row.layer_plan_id)
            return true;
        const { data, error } = await this.supabase
            .from('layering_plans')
            .select('status,layer_plan_metadata')
            .eq('layer_plan_id', row.layer_plan_id)
            .maybeSingle();
        if (error || !data || String(data.status ?? '') !== 'active')
            return false;
        const parsed = (0, layeringPlanPersistence_1.parsePersistedLayeringPlan)(data.layer_plan_metadata);
        if (!parsed.ok)
            return false;
        const snapshot = parsed.snapshot;
        if (snapshot.planId !== row.layer_plan_id
            || snapshot.signalId !== row.signal_id
            || snapshot.brokerAccountId !== row.broker_account_id
            || snapshot.symbol !== row.symbol
            || (snapshot.side === 'buy') !== row.is_buy
            || snapshot.fundedPrices == null
            || snapshot.lots == null)
            return false;
        const idx = row.step_idx - 1;
        if (idx < 0 || snapshot.fundedPrices[idx] !== row.trigger_price || snapshot.lots[idx] !== row.volume)
            return false;
        return (0, layeringModeRollout_1.resolveLayeringModeRolloutDecision)({
            mode: snapshot.mode,
            brokerAccountId: row.broker_account_id,
        }).executionAllowed;
    }
}
exports.RangeBrokerPendingMonitor = RangeBrokerPendingMonitor;
