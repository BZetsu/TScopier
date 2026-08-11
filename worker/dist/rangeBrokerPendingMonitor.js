"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RangeBrokerPendingMonitor = void 0;
const fxsocketClient_1 = require("./fxsocketClient");
const mtApiByAccount_1 = require("./mtApiByAccount");
const autoManagement_1 = require("./autoManagement");
const basketModFollowUp_1 = require("./basketModFollowUp");
const brokerPendingFillStops_1 = require("./brokerPendingFillStops");
const normalizeManualSettings_1 = require("./manualPlanning/normalizeManualSettings");
const channelTradingConfig_1 = require("./channelTradingConfig");
const rangePendingLadderSync_1 = require("./rangePendingLadderSync");
const rangeBasketTpSync_1 = require("./rangeBasketTpSync");
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const basketReconcileTargets_1 = require("./basketReconcileTargets");
const monitorIdleGate_1 = require("./monitorIdleGate");
const copierPause_1 = require("./copierPause");
const brokerPendingFillDetect_1 = require("./brokerPendingFillDetect");
const brokerPendingStopsSync_1 = require("./brokerPendingStopsSync");
const rangeBrokerPendingHelpers_1 = require("./rangeBrokerPendingHelpers");
const rangeLayerBasketWatch_1 = require("./rangeLayerBasketWatch");
const layeringPlanPersistence_1 = require("./manualPlanning/layeringPlanPersistence");
const layeringModeRollout_1 = require("./manualPlanning/layeringModeRollout");
const layeringPlanLifecycle_1 = require("./layeringPlanLifecycle");
const layeringModeBrokerPendingRecovery_1 = require("./tradeExecutor/layeringModeBrokerPendingRecovery");
const businessEvents_1 = require("./observability/businessEvents");
const ACTIVE_MS = (0, monitorIdleGate_1.monitorActiveIntervalMs)('RANGE_BROKER_PENDING_TICK_MS', 2000);
const IDLE_MS = (0, monitorIdleGate_1.monitorIdleIntervalMs)('RANGE_BROKER_PENDING_IDLE_MS', 15000);
const MISSING_BEFORE_ASSUME_GONE = 6;
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
async function enqueueReconcileAfterBrokerFill(supabase, leg, channelId, manual) {
    const familyTrades = await (0, basketSlTpReconcile_1.loadOpenBasketLegs)(supabase, leg.broker_account_id, leg.signal_id, leg.symbol);
    if (!familyTrades.length)
        return;
    const direction = leg.is_buy ? 'buy' : 'sell';
    const { perLegTargets, signalTps } = await (0, basketReconcileTargets_1.resolveFreshBasketReconcileTargets)(supabase, {
        anchorSignalId: leg.signal_id,
        channelId,
        symbol: leg.symbol,
        direction,
        userId: leg.user_id,
        brokerAccountId: leg.broker_account_id,
        familyTrades,
        storedTargets: [],
        manual: {
            range_trading: manual.range_trading === true,
            tp_lots: manual.tp_lots,
        },
        nImmCwe: 0,
        overrideTp: null,
    });
    if (!perLegTargets.length)
        return;
    await (0, basketSlTpReconcile_1.upsertBasketReconcileJob)(supabase, {
        userId: leg.user_id,
        brokerAccountId: leg.broker_account_id,
        anchorSignalId: leg.signal_id,
        sourceSignalId: leg.signal_id,
        channelId,
        symbol: leg.symbol,
        direction,
        perLegTargets,
        familyTrades,
        signalTps,
        tpLots: manual.tp_lots,
        virtualPendingsSnapshot: null,
        nImmCwe: 0,
        overrideTp: null,
        lastError: 'Broker pending naked fill; reconcile basket SL/TP',
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
        (0, businessEvents_1.captureBusinessIssue)({
            category: 'persistence',
            event: 'broker_success_persistence_failed',
            severity: 'error',
            reasonCode: 'BROKER_PENDING_FILL_DB_FAILURE',
            message: 'Broker-pending order filled but trade row persistence failed',
            userImpact: 'manual_review_required',
            fingerprint: ['broker_success_persistence_failed', 'broker_pending_fill', 'BROKER_PENDING_FILL_DB_FAILURE'],
            context: {
                user_id: leg.user_id,
                signal_id: leg.signal_id,
                broker_account_id: leg.broker_account_id,
                pending_leg_id: leg.id,
                basket_id: `${leg.signal_id}:${leg.broker_account_id}`,
                layer_plan_id: leg.layer_plan_id ?? null,
                layer_step_idx: leg.step_idx,
                symbol: leg.symbol,
                side: leg.is_buy ? 'buy' : 'sell',
                execution_mechanism: 'broker_pending_order',
                operation: 'broker_pending_fill_persist',
                extra: {
                    broker_ticket_present: ticketForTrade != null,
                    broker_database_state_may_disagree: true,
                },
            },
        });
        return;
    }
    const tradeRowId = insTrade?.id ?? null;
    const ticketNum = ticketForTrade != null ? Number(ticketForTrade) : NaN;
    const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(platformByUuid, leg.metaapi_account_id);
    if (tradeRowId && api && Number.isFinite(ticketNum) && ticketNum > 0) {
        // Primary path (same as virtual after fire): redistribute SL + TP% across
        // the whole open basket. Resting limits stay naked; only open positions
        // get OrderModify'd.
        await new Promise(r => setTimeout(r, Number(process.env.RANGE_REBALANCE_SETTLE_MS ?? 150)));
        try {
            await rebalanceAfterFill(supabase, platformByUuid, leg, channelId);
        }
        catch (rebalErr) {
            console.warn(`[rangeBrokerPending] TP rebalance leg=${leg.id}:`, rebalErr);
            (0, businessEvents_1.captureBusinessIssue)({
                category: 'management',
                event: 'basket_tp_sync_failed',
                severity: 'warning',
                reasonCode: 'BROKER_PENDING_FILL_TP_REBALANCE_FAILED',
                message: 'Broker-pending fill TP rebalance failed; reconcile will retry',
                userImpact: 'delayed',
                context: {
                    user_id: leg.user_id,
                    signal_id: leg.signal_id,
                    broker_account_id: leg.broker_account_id,
                    pending_leg_id: leg.id,
                    trade_id: tradeRowId,
                    basket_id: `${leg.signal_id}:${leg.broker_account_id}`,
                    layer_plan_id: leg.layer_plan_id ?? null,
                    layer_step_idx: leg.step_idx,
                    symbol: leg.symbol,
                    side: leg.is_buy ? 'buy' : 'sell',
                    execution_mechanism: 'broker_pending_order',
                    operation: 'broker_pending_fill_tp_rebalance',
                },
            });
        }
        // Read post-rebalance stops so mgmt follow-up only overlays newer adjusts.
        let existingSl = null;
        let existingTp = null;
        try {
            const { data: tradeStops } = await supabase
                .from('trades')
                .select('sl,tp')
                .eq('id', tradeRowId)
                .maybeSingle();
            const sl = Number(tradeStops?.sl);
            const tp = Number(tradeStops?.tp);
            existingSl = Number.isFinite(sl) && sl > 0 ? sl : null;
            existingTp = Number.isFinite(tp) && tp > 0 ? tp : null;
        }
        catch { /* best-effort */ }
        // Last resort: if rebalance left this leg naked, assign from effective/leg stops.
        if (existingSl == null && existingTp == null) {
            try {
                const assigned = await (0, brokerPendingFillStops_1.assignNakedBrokerFillStops)({
                    supabase,
                    api,
                    leg,
                    tradeRowId,
                    ticket: ticketNum,
                    entryPrice: entryPx,
                    channelId,
                });
                if (assigned.ok) {
                    existingSl = assigned.stoploss > 0 ? assigned.stoploss : null;
                    existingTp = assigned.takeprofit > 0 ? assigned.takeprofit : null;
                }
            }
            catch (assignErr) {
                console.warn(`[rangeBrokerPending] fallback stops leg=${leg.id}:`, assignErr);
                (0, businessEvents_1.captureBusinessIssue)({
                    category: 'management',
                    event: 'deferred_trade_follow_up_failed',
                    severity: 'error',
                    reasonCode: 'BROKER_PENDING_FILL_STOPS_ASSIGN_FAILED',
                    message: 'Broker-pending fill fallback SL/TP assignment failed',
                    userImpact: 'partial',
                    context: {
                        user_id: leg.user_id,
                        signal_id: leg.signal_id,
                        broker_account_id: leg.broker_account_id,
                        pending_leg_id: leg.id,
                        trade_id: tradeRowId,
                        basket_id: `${leg.signal_id}:${leg.broker_account_id}`,
                        layer_plan_id: leg.layer_plan_id ?? null,
                        layer_step_idx: leg.step_idx,
                        symbol: leg.symbol,
                        side: leg.is_buy ? 'buy' : 'sell',
                        execution_mechanism: 'broker_pending_order',
                        operation: 'broker_pending_fill_stops_assign',
                        extra: { broker_database_state_may_disagree: true },
                    },
                });
            }
        }
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
                existingSl,
                existingTp,
                tpLots: manual.tp_lots,
                isBuy: leg.is_buy,
            });
        }
        catch (hookErr) {
            console.warn(`[rangeBrokerPending] SL/TP follow-up leg=${leg.id}:`, hookErr);
            (0, businessEvents_1.captureBusinessIssue)({
                category: 'management',
                event: 'deferred_trade_follow_up_failed',
                severity: 'error',
                reasonCode: 'BROKER_PENDING_FILL_FOLLOW_UP_FAILED',
                message: 'Broker-pending fill SL/TP follow-up failed',
                userImpact: 'partial',
                context: {
                    user_id: leg.user_id,
                    signal_id: leg.signal_id,
                    broker_account_id: leg.broker_account_id,
                    pending_leg_id: leg.id,
                    trade_id: tradeRowId,
                    basket_id: `${leg.signal_id}:${leg.broker_account_id}`,
                    layer_plan_id: leg.layer_plan_id ?? null,
                    layer_step_idx: leg.step_idx,
                    symbol: leg.symbol,
                    side: leg.is_buy ? 'buy' : 'sell',
                    execution_mechanism: 'broker_pending_order',
                    operation: 'broker_pending_fill_follow_up',
                },
            });
        }
        // Always enqueue reconcile so failed OrderModifies retry.
        try {
            await enqueueReconcileAfterBrokerFill(supabase, leg, channelId, manual);
        }
        catch (enqErr) {
            console.warn(`[rangeBrokerPending] reconcile enqueue leg=${leg.id}:`, enqErr);
            (0, businessEvents_1.captureBusinessIssue)({
                category: 'reconciliation',
                event: 'deferred_trade_follow_up_failed',
                severity: 'warning',
                reasonCode: 'BROKER_PENDING_FILL_RECONCILE_ENQUEUE_FAILED',
                message: 'Broker-pending fill reconcile enqueue failed',
                userImpact: 'delayed',
                context: {
                    user_id: leg.user_id,
                    signal_id: leg.signal_id,
                    broker_account_id: leg.broker_account_id,
                    pending_leg_id: leg.id,
                    trade_id: tradeRowId,
                    basket_id: `${leg.signal_id}:${leg.broker_account_id}`,
                    layer_plan_id: leg.layer_plan_id ?? null,
                    layer_step_idx: leg.step_idx,
                    symbol: leg.symbol,
                    operation: 'broker_pending_fill_reconcile_enqueue',
                },
            });
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
        /** Baskets whose resting limits already had a stop-sync attempt this process. */
        this.stopsHealed = new Set();
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
        // Heal naked resting limits once open basket legs already have SL/TP
        // (common when signal had no SL/TP at place time).
        const healKeys = new Set();
        for (const r of watchRows) {
            const basketKey = `${r.signal_id}|${r.broker_account_id}|${r.metaapi_account_id}`;
            const missingDbStops = !(Number(r.stoploss) > 0) || !(Number(r.takeprofit) > 0);
            if (missingDbStops || !this.stopsHealed.has(basketKey)) {
                healKeys.add(basketKey);
            }
        }
        for (const key of healKeys) {
            const [signalId, brokerAccountId, uuid] = key.split('|');
            if (!signalId || !brokerAccountId || !uuid)
                continue;
            const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(this.platformByUuid, uuid);
            if (!api)
                continue;
            try {
                const modified = await (0, brokerPendingStopsSync_1.healNakedBrokerPendingStops)({
                    supabase: this.supabase,
                    api,
                    signalId,
                    brokerAccountId,
                });
                if (modified > 0)
                    this.stopsHealed.add(key);
                else {
                    // No open-trade stops yet, or already synced on broker — avoid hot loop
                    // once DB rows have stops.
                    const stillMissing = watchRows.some(r => r.signal_id === signalId
                        && r.broker_account_id === brokerAccountId
                        && (!(Number(r.stoploss) > 0) || !(Number(r.takeprofit) > 0)));
                    if (!stillMissing)
                        this.stopsHealed.add(key);
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[rangeBrokerPendingMonitor] stop heal failed signal=${signalId}: ${msg}`);
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
            // Tickets already booked as open trades for these signals — exclude them
            // when matching comment/signal so immediate market legs aren't mistaken
            // for a pending fill after the limit ticket disappears.
            const signalIds = [...new Set(group.map(r => r.signal_id))];
            const excludeTickets = new Set();
            try {
                const { data: openTrades } = await this.supabase
                    .from('trades')
                    .select('metaapi_order_id')
                    .in('signal_id', signalIds)
                    .eq('broker_account_id', group[0].broker_account_id)
                    .eq('status', 'open');
                for (const t of openTrades ?? []) {
                    const id = t.metaapi_order_id;
                    if (id && /^\d+$/.test(id))
                        excludeTickets.add(id);
                }
            }
            catch { /* best-effort */ }
            const needClosed = [];
            for (const row of group) {
                const decision = (0, brokerPendingFillDetect_1.decideBrokerPendingOpenedState)(opened, row, excludeTickets);
                if (decision.kind === 'still_pending') {
                    this.missingStreak.delete(row.id);
                    continue;
                }
                if (decision.kind === 'filled') {
                    this.missingStreak.delete(row.id);
                    await markBrokerRangeLegFilled(this.supabase, this.platformByUuid, row, decision.hit.fillPrice, decision.hit.positionTicket);
                    if (decision.hit.positionTicket)
                        excludeTickets.add(decision.hit.positionTicket);
                    continue;
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
                const closedFill = (0, brokerPendingFillDetect_1.decideBrokerPendingClosedFill)(opened, closed, row, excludeTickets);
                if (closedFill) {
                    this.missingStreak.delete(row.id);
                    await markBrokerRangeLegFilled(this.supabase, this.platformByUuid, row, closedFill.fillPrice, closedFill.positionTicket);
                    if (closedFill.positionTicket)
                        excludeTickets.add(closedFill.positionTicket);
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
                    (0, businessEvents_1.captureBusinessIssue)({
                        category: 'layering',
                        event: 'layering_native_reconciliation_required',
                        severity: 'error',
                        reasonCode: 'BROKER_PENDING_MISSING',
                        message: 'Broker-native range pending leg was missing after reconciliation threshold',
                        userImpact: 'manual_review_required',
                        context: {
                            user_id: row.user_id,
                            signal_id: row.signal_id,
                            broker_account_id: row.broker_account_id,
                            pending_leg_id: row.id,
                            layer_plan_id: row.layer_plan_id ?? null,
                            layer_step_idx: row.step_idx,
                            symbol: row.symbol,
                            execution_mechanism: 'broker_pending_order',
                            operation: 'native_pending_reconcile',
                            extra: {
                                missing_streak_threshold: MISSING_BEFORE_ASSUME_GONE,
                                ambiguous_execution: true,
                            },
                        },
                    });
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
