"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeExecutor = void 0;
const metatraderapi_1 = require("./metatraderapi");
const manualPlanner_1 = require("./manualPlanner");
/**
 * Direct trade-execution path. Listens to `signals` Realtime, fans out to every
 * active broker for the signal's owner, and calls MetatraderAPI directly. The
 * old `management_jobs` queue + execute-trade Edge round-trip is bypassed so a
 * parsed signal goes Telegram -> parse-signal -> OrderSend with one HTTPS hop.
 */
const PARSED_STATUSES = new Set(['parsed']);
const SYMBOL_CACHE_TTL_MS = 10 * 60000;
const SYMBOL_LIST_TTL_MS = 30 * 60000;
function isMtUuid(s) {
    if (!s)
        return false;
    const v = s.trim();
    if (!v || v.includes('|'))
        return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function applySymbolMapping(raw, broker) {
    const m = (broker.manual_settings ?? {});
    const upper = raw.toUpperCase();
    const mapped = (m.symbol_mapping?.[upper] ?? upper).toUpperCase();
    const prefix = (m.symbol_prefix ?? '').toUpperCase();
    const suffix = (m.symbol_suffix ?? '').toUpperCase();
    if (m.symbol_to_trade && m.symbol_to_trade.trim())
        return m.symbol_to_trade.trim().toUpperCase();
    return `${prefix}${mapped}${suffix}`;
}
function isExcluded(symbol, broker) {
    const m = (broker.manual_settings ?? {});
    const list = (m.symbols_exclude ?? []).map(s => String(s).toUpperCase());
    return list.includes(symbol.toUpperCase());
}
function operationFor(action, signal) {
    const a = action.toLowerCase();
    const hasEntry = signal.entry_price != null;
    if (a === 'buy')
        return hasEntry ? 'BuyLimit' : 'Buy';
    if (a === 'sell')
        return hasEntry ? 'SellLimit' : 'Sell';
    return null;
}
function isManagementAction(action) {
    const a = action.toLowerCase();
    return a === 'close' || a === 'breakeven' || a === 'partial_profit' || a === 'partial_breakeven' || a === 'modify';
}
function computeLot(broker, signal) {
    const mode = broker.copier_mode ?? 'ai';
    if (mode === 'manual') {
        const m = (broker.manual_settings ?? {});
        if (m.risk_mode === 'dynamic_balance_percent') {
            const pct = Number(m.dynamic_balance_percent ?? 1);
            const bal = Number(broker.last_balance ?? 0);
            if (bal > 0 && pct > 0) {
                // Conservative: 0.01 lot per 1% of balance per $1000 — caller can refine via SymbolParams.
                return Math.max(0.01, +(bal * (pct / 100) / 1000).toFixed(2));
            }
        }
        if (typeof signal.lot_size === 'number' && signal.lot_size > 0)
            return signal.lot_size;
        return Math.max(0.01, Number(m.fixed_lot ?? broker.default_lot_size ?? 0.01));
    }
    // AI mode
    const ai = (broker.ai_settings ?? {});
    const ref = Number(ai.reference_equity ?? 1000);
    const bal = Number(broker.last_balance ?? broker.last_equity ?? ref);
    const base = Number(ai.fallback_lot ?? broker.default_lot_size ?? 0.01);
    const scaled = ref > 0 ? base * (bal / ref) : base;
    const min = Number(ai.min_lot ?? 0.01);
    const max = Number(ai.max_lot ?? 100);
    const final = Math.max(min, Math.min(max, scaled));
    return +final.toFixed(2);
}
function roundLot(volume, params) {
    if (!params)
        return Math.max(0.01, +volume.toFixed(2));
    const step = params.lotStep || 0.01;
    const min = params.minLot || step;
    const max = params.maxLot || 100;
    const rounded = Math.max(min, Math.min(max, Math.round(volume / step) * step));
    return +rounded.toFixed(2);
}
function channelMatches(broker, channelId) {
    const enforce = broker.enforce_signal_channel_filter === true;
    if (!enforce)
        return true;
    const ids = broker.signal_channel_ids ?? [];
    if (!ids.length)
        return true;
    if (!channelId)
        return false;
    return ids.includes(channelId);
}
class TradeExecutor {
    constructor(supabase) {
        this.supabase = supabase;
        this.timer = null;
        this.signalsChannel = null;
        this.brokersChannel = null;
        this.channelsChannel = null;
        this.brokersByUser = new Map();
        this.brokersById = new Map();
        this.inflight = new Set();
        this.symbolCache = new Map();
        /** Per-broker `/Symbols` cache used to map signal symbols (e.g. BTCUSD) to broker variants (BTCUSDm). */
        this.symbolListCache = new Map();
        /** Cached channel rows keyed by `telegram_channels.id` — refreshed on demand. */
        this.channelKeywordsCache = new Map();
        this.api = (0, metatraderapi_1.getMetatraderApi)();
        if (!this.api) {
            console.warn('[tradeExecutor] METATRADERAPI_KEY missing — trade execution disabled.');
        }
    }
    async start() {
        await this.loadBrokers();
        this.subscribeSignals();
        this.subscribeBrokers();
        this.subscribeChannelKeywords();
        // Periodic safety sweep: catch any 'parsed' signals we may have missed
        // (Realtime drops, restarts). Cheap query, runs every 15s.
        this.timer = setInterval(() => {
            this.sweep().catch(err => console.error('[tradeExecutor] sweep failed:', err));
        }, 15000);
        this.timer.unref?.();
        console.log('[tradeExecutor] started');
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        if (this.signalsChannel) {
            void this.supabase.removeChannel(this.signalsChannel);
            this.signalsChannel = null;
        }
        if (this.brokersChannel) {
            void this.supabase.removeChannel(this.brokersChannel);
            this.brokersChannel = null;
        }
        if (this.channelsChannel) {
            void this.supabase.removeChannel(this.channelsChannel);
            this.channelsChannel = null;
        }
    }
    // ── caches ────────────────────────────────────────────────────────────
    async loadBrokers() {
        const { data, error } = await this.supabase
            .from('broker_accounts')
            .select('*')
            .eq('is_active', true);
        if (error) {
            console.error('[tradeExecutor] loadBrokers failed:', error.message);
            return;
        }
        this.brokersByUser.clear();
        this.brokersById.clear();
        for (const row of (data ?? [])) {
            this.brokersById.set(row.id, row);
            const arr = this.brokersByUser.get(row.user_id) ?? [];
            arr.push(row);
            this.brokersByUser.set(row.user_id, arr);
        }
        console.log(`[tradeExecutor] cached ${this.brokersById.size} broker accounts across ${this.brokersByUser.size} users`);
    }
    upsertBrokerCache(row) {
        const previous = this.brokersById.get(row.id);
        this.brokersById.set(row.id, row);
        const userId = row.user_id;
        const list = (this.brokersByUser.get(userId) ?? []).filter(b => b.id !== row.id);
        if (row.is_active)
            list.push(row);
        this.brokersByUser.set(userId, list);
        if (previous && previous.user_id !== userId) {
            const prev = (this.brokersByUser.get(previous.user_id) ?? []).filter(b => b.id !== row.id);
            this.brokersByUser.set(previous.user_id, prev);
        }
    }
    removeBrokerCache(id) {
        const row = this.brokersById.get(id);
        if (!row)
            return;
        this.brokersById.delete(id);
        const list = (this.brokersByUser.get(row.user_id) ?? []).filter(b => b.id !== id);
        this.brokersByUser.set(row.user_id, list);
    }
    // ── realtime ──────────────────────────────────────────────────────────
    subscribeSignals() {
        if (this.signalsChannel)
            return;
        this.signalsChannel = this.supabase
            .channel('trade_executor_signals')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'signals' }, (payload) => {
            const row = payload.new;
            if (!row)
                return;
            if (!PARSED_STATUSES.has(row.status))
                return;
            this.handleSignal(row).catch(err => console.error(`[tradeExecutor] handleSignal failed for ${row.id}:`, err));
        })
            .subscribe();
    }
    subscribeBrokers() {
        if (this.brokersChannel)
            return;
        this.brokersChannel = this.supabase
            .channel('trade_executor_brokers')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'broker_accounts' }, (payload) => {
            const evt = payload.eventType;
            if (evt === 'DELETE') {
                const id = (payload.old?.id ?? '');
                if (id)
                    this.removeBrokerCache(id);
                return;
            }
            const row = payload.new;
            if (!row)
                return;
            if (row.is_active === false)
                this.removeBrokerCache(row.id);
            else
                this.upsertBrokerCache(row);
        })
            .subscribe();
    }
    subscribeChannelKeywords() {
        if (this.channelsChannel)
            return;
        this.channelsChannel = this.supabase
            .channel('trade_executor_channels')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'telegram_channels' }, (payload) => {
            const row = payload.new;
            if (!row?.id)
                return;
            // Refresh cache eagerly so the next signal picks up edits made in Copier Engine.
            this.channelKeywordsCache.set(row.id, { keywords: row.channel_keywords ?? null, loadedAt: Date.now() });
        })
            .subscribe();
    }
    async sweep() {
        const since = new Date(Date.now() - 5 * 60000).toISOString();
        const { data } = await this.supabase
            .from('signals')
            .select('id,user_id,channel_id,parsed_data,status,parent_signal_id,is_modification')
            .eq('status', 'parsed')
            .gte('created_at', since)
            .limit(50);
        for (const row of (data ?? [])) {
            if (this.inflight.has(row.id))
                continue;
            // Skip if a trade for this signal already exists.
            const { count } = await this.supabase
                .from('trades')
                .select('id', { count: 'exact', head: true })
                .eq('signal_id', row.id);
            if ((count ?? 0) > 0)
                continue;
            await this.handleSignal(row);
        }
    }
    // ── execution ─────────────────────────────────────────────────────────
    async handleSignal(row) {
        if (!this.api)
            return;
        if (this.inflight.has(row.id))
            return;
        this.inflight.add(row.id);
        try {
            const parsed = row.parsed_data;
            if (!parsed || !parsed.action)
                return;
            const action = String(parsed.action).toLowerCase();
            if (action === 'ignore')
                return;
            const brokers = (this.brokersByUser.get(row.user_id) ?? []).filter(b => b.is_active && isMtUuid(b.metaapi_account_id) && channelMatches(b, row.channel_id));
            if (!brokers.length)
                return;
            // Pre-fetch channel keywords once per signal so manual-mode brokers can
            // honour delay_msec / prefer_entry / *_in_pips / ignore_keyword.
            const channelKeywords = await this.getChannelKeywords(row.channel_id);
            const rawText = String(parsed.raw_instruction ?? '').toLowerCase();
            const ignoreKw = channelKeywords?.additional?.ignore_keyword?.trim().toLowerCase();
            const skipKw = channelKeywords?.additional?.skip_keyword?.trim().toLowerCase();
            if ((ignoreKw && rawText.includes(ignoreKw)) || (skipKw && rawText.includes(skipKw))) {
                // Channel-level ignore — parse-signal usually already short-circuits this,
                // but we double-check here so a stale parse can't slip through.
                return;
            }
            if (isManagementAction(action)) {
                await this.applyManagement(row, parsed, brokers);
                return;
            }
            const op = operationFor(action, parsed);
            if (!op || !parsed.symbol)
                return;
            await Promise.allSettled(brokers.map(b => this.sendOrder(row, parsed, op, b, channelKeywords)));
        }
        finally {
            this.inflight.delete(row.id);
        }
    }
    async getChannelKeywords(channelId) {
        if (!channelId)
            return null;
        const cached = this.channelKeywordsCache.get(channelId);
        if (cached && Date.now() - cached.loadedAt < 5 * 60000)
            return cached.keywords;
        try {
            const { data } = await this.supabase
                .from('telegram_channels')
                .select('channel_keywords')
                .eq('id', channelId)
                .maybeSingle();
            const keywords = data?.channel_keywords ?? null;
            this.channelKeywordsCache.set(channelId, { keywords, loadedAt: Date.now() });
            return keywords;
        }
        catch {
            this.channelKeywordsCache.set(channelId, { keywords: null, loadedAt: Date.now() });
            return null;
        }
    }
    async hasOpenTradeForSymbol(brokerId, symbol) {
        try {
            const { count } = await this.supabase
                .from('trades')
                .select('id', { count: 'exact', head: true })
                .eq('broker_account_id', brokerId)
                .eq('symbol', symbol)
                .eq('status', 'open');
            return (count ?? 0) > 0;
        }
        catch {
            return false;
        }
    }
    async sendOrder(signal, parsed, op, broker, channelKeywords) {
        if (!this.api)
            return;
        const uuid = broker.metaapi_account_id;
        const requestedSymbol = applySymbolMapping(parsed.symbol, broker);
        if (isExcluded(requestedSymbol, broker))
            return;
        // Resolve to the broker's actual instrument name (e.g. BTCUSD → BTCUSDm).
        // Falls back to the requested symbol when /Symbols is unavailable.
        const symbol = await this.resolveBrokerSymbol(uuid, requestedSymbol);
        if (symbol.toUpperCase() !== requestedSymbol.toUpperCase()) {
            console.log(`[tradeExecutor] symbol resolved broker=${broker.id} ${requestedSymbol} → ${symbol}`);
        }
        const params = await this.getSymbolParams(uuid, symbol).catch(() => null);
        const baseLot = roundLot(computeLot(broker, parsed), params);
        const isManual = (broker.copier_mode ?? 'ai') === 'manual';
        const manual = (broker.manual_settings ?? {});
        // Stop here when the user opted out of stacking trades on the same symbol.
        if (isManual && manual.add_new_trades_to_existing === false) {
            const already = await this.hasOpenTradeForSymbol(broker.id, symbol);
            if (already) {
                await this.logSendSkipped(signal, broker, 'add_new_trades_to_existing=false', { symbol });
                return;
            }
        }
        // Build the order list. In AI mode we keep the original single-order shape;
        // manual mode delegates to the planner so filters / multi-TP / pip-derived
        // SL & TP / pending expiry / reverse all apply consistently.
        let plan;
        if (isManual) {
            const plannerParsed = {
                action: parsed.action,
                symbol: parsed.symbol,
                entry_price: parsed.entry_price,
                entry_zone_low: parsed.entry_zone_low,
                entry_zone_high: parsed.entry_zone_high,
                sl: parsed.sl,
                tp: parsed.tp,
                lot_size: parsed.lot_size,
                open_tp: parsed.open_tp,
                partial_close_fraction: parsed.partial_close_fraction,
                raw_instruction: parsed.raw_instruction,
            };
            plan = (0, manualPlanner_1.planManualOrders)({
                parsed: plannerParsed,
                resolvedSymbol: symbol,
                baseOperation: op,
                manual,
                channelKeywords,
                manualLot: baseLot,
                ctx: {
                    point: params?.point ?? 0.00001,
                    digits: params?.digits ?? 5,
                    defaultLot: Number(broker.default_lot_size ?? 0.01),
                    lastBalance: broker.last_balance ?? null,
                },
                commentPrefix: `TSCopier:${signal.id.slice(0, 8)}`,
                expertId: 909090,
                slippage: 20,
            });
        }
        else {
            plan = {
                orders: [{
                        symbol,
                        operation: op,
                        volume: baseLot,
                        price: parsed.entry_price ?? 0,
                        stoploss: parsed.sl ?? 0,
                        takeprofit: parsed.tp?.[0] ?? 0,
                        slippage: 20,
                        comment: `TSCopier:${signal.id.slice(0, 8)}`,
                        expertID: 909090,
                    }],
                delay_ms: 0,
            };
        }
        if (plan.orders.length === 0) {
            await this.logSendSkipped(signal, broker, plan.skip_reason ?? 'filtered', { symbol });
            return;
        }
        if (plan.delay_ms > 0) {
            await new Promise(resolve => setTimeout(resolve, Math.min(plan.delay_ms, 30000)));
        }
        // Round volumes per the live SymbolParams before sending.
        const ordersToSend = plan.orders.map(o => ({ ...o, volume: roundLot(o.volume, params) }));
        await Promise.allSettled(ordersToSend.map(async (args, idx) => {
            const t0 = Date.now();
            try {
                const result = await this.api.orderSend(uuid, args);
                const latencyMs = Date.now() - t0;
                console.log(`[tradeExecutor] OrderSend ok signal=${signal.id} broker=${broker.id} ticket=${result.ticket} leg=${idx + 1}/${ordersToSend.length} ${latencyMs}ms`);
                await this.supabase.from('trades').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    telegram_channel_id: signal.channel_id,
                    broker_account_id: broker.id,
                    metaapi_order_id: result.ticket != null ? String(result.ticket) : null,
                    symbol: args.symbol,
                    direction: args.operation.toLowerCase().includes('sell') ? 'sell' : 'buy',
                    entry_price: result.openPrice ?? args.price ?? null,
                    sl: result.stopLoss ?? args.stoploss ?? null,
                    tp: result.takeProfit ?? args.takeprofit ?? null,
                    lot_size: result.lots ?? args.volume,
                    status: args.operation.includes('Limit') || args.operation.includes('Stop') ? 'pending' : 'open',
                    opened_at: new Date().toISOString(),
                });
                await this.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'order_send',
                    status: 'success',
                    request_payload: args,
                    response_payload: { ticket: result.ticket, latency_ms: latencyMs, leg: idx + 1, total: ordersToSend.length },
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[tradeExecutor] OrderSend failed signal=${signal.id} broker=${broker.id} leg=${idx + 1}/${ordersToSend.length}:`, msg);
                await this.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'order_send',
                    status: 'failed',
                    request_payload: args,
                    error_message: msg,
                });
            }
        }));
    }
    async logSendSkipped(signal, broker, reason, extra) {
        try {
            await this.supabase.from('trade_execution_logs').insert({
                user_id: signal.user_id,
                signal_id: signal.id,
                broker_account_id: broker.id,
                action: 'order_send',
                status: 'skipped',
                request_payload: { skip_reason: reason, ...extra },
            });
        }
        catch {
            // Logging failure is non-fatal.
        }
    }
    async applyManagement(signal, parsed, brokers) {
        if (!this.api)
            return;
        if (!signal.parent_signal_id)
            return;
        const { data: trades } = await this.supabase
            .from('trades')
            .select('id,broker_account_id,metaapi_order_id,symbol,lot_size,status')
            .eq('signal_id', signal.parent_signal_id);
        const rows = (trades ?? []);
        if (!rows.length)
            return;
        const byBroker = new Map(brokers.map(b => [b.id, b]));
        const action = String(parsed.action).toLowerCase();
        await Promise.allSettled(rows.map(async (trade) => {
            const broker = byBroker.get(trade.broker_account_id);
            if (!broker || !isMtUuid(broker.metaapi_account_id))
                return;
            const uuid = broker.metaapi_account_id;
            const ticket = Number(trade.metaapi_order_id);
            if (!Number.isFinite(ticket) || ticket <= 0)
                return;
            try {
                if (action === 'close') {
                    await this.api.orderClose(uuid, { ticket });
                    await this.supabase.from('trades').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', trade.id);
                }
                else if (action === 'partial_profit' || action === 'partial_breakeven') {
                    const fraction = typeof parsed.partial_close_fraction === 'number' && parsed.partial_close_fraction > 0
                        ? Math.min(0.95, parsed.partial_close_fraction)
                        : 0.5;
                    const lots = +(trade.lot_size * fraction).toFixed(2);
                    await this.api.orderClose(uuid, { ticket, lots });
                }
                else if (action === 'breakeven') {
                    const { data: t } = await this.supabase.from('trades').select('entry_price').eq('id', trade.id).maybeSingle();
                    const entry = Number(t?.entry_price ?? 0);
                    if (entry > 0)
                        await this.api.orderModify(uuid, { ticket, stoploss: entry });
                }
                else if (action === 'modify') {
                    await this.api.orderModify(uuid, {
                        ticket,
                        stoploss: parsed.sl ?? 0,
                        takeprofit: parsed.tp?.[0] ?? 0,
                    });
                    await this.supabase.from('trades').update({
                        sl: parsed.sl ?? null,
                        tp: parsed.tp?.[0] ?? null,
                    }).eq('id', trade.id);
                }
                await this.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: `mgmt_${action}`,
                    status: 'success',
                    request_payload: { ticket, action },
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await this.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: `mgmt_${action}`,
                    status: 'failed',
                    request_payload: { ticket, action },
                    error_message: msg,
                });
            }
        }));
    }
    async getSymbolParams(uuid, symbol) {
        const key = `${uuid}:${symbol.toUpperCase()}`;
        const cached = this.symbolCache.get(key);
        if (cached && (Date.now() - cached.loadedAt) < SYMBOL_CACHE_TTL_MS)
            return cached;
        if (!this.api)
            return null;
        try {
            const p = await this.api.symbolParams(uuid, symbol);
            const entry = {
                digits: Number(p.symbol?.digits ?? 5),
                point: Number(p.symbol?.point ?? 0.00001),
                minLot: Number(p.groupParams?.minLot ?? 0.01),
                maxLot: Number(p.groupParams?.maxLot ?? 100),
                lotStep: Number(p.groupParams?.lotStep ?? 0.01),
                loadedAt: Date.now(),
            };
            this.symbolCache.set(key, entry);
            return entry;
        }
        catch {
            return null;
        }
    }
    /** Load (and cache) the broker's full symbol list. Returns null if unavailable. */
    async getSymbolList(uuid) {
        const cached = this.symbolListCache.get(uuid);
        if (cached && (Date.now() - cached.loadedAt) < SYMBOL_LIST_TTL_MS)
            return cached;
        if (!this.api)
            return null;
        try {
            const raw = await this.api.symbols(uuid);
            const list = [];
            const set = new Set();
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    let name = null;
                    if (typeof item === 'string')
                        name = item;
                    else if (item && typeof item === 'object') {
                        const o = item;
                        const n = o.symbolName ?? o.SymbolName ?? o.symbol ?? o.Symbol ?? o.name ?? o.Name;
                        if (typeof n === 'string')
                            name = n;
                    }
                    if (name && name.trim()) {
                        list.push(name);
                        set.add(name.toUpperCase());
                    }
                }
            }
            if (!list.length)
                return null;
            const entry = { set, list, loadedAt: Date.now() };
            this.symbolListCache.set(uuid, entry);
            return entry;
        }
        catch {
            return null;
        }
    }
    /**
     * Map a generic symbol (e.g. 'BTCUSD') to the exact instrument name the broker
     * exposes (e.g. 'BTCUSDm', 'BTCUSD.r', 'BTCUSD_i'). Strategy:
     *   1. Honour an explicit manual mapping when one exists for this symbol.
     *   2. Fall back to fuzzy matching against `/Symbols` using common broker suffixes
     *      and prefix/suffix substitution. Picks the shortest match (closest variant).
     */
    async resolveBrokerSymbol(uuid, requested) {
        const target = requested.toUpperCase();
        const inventory = await this.getSymbolList(uuid);
        if (!inventory)
            return requested;
        if (inventory.set.has(target)) {
            const exact = inventory.list.find(s => s.toUpperCase() === target);
            return exact ?? requested;
        }
        const SUFFIXES = ['', 'M', '.M', 'M.RAW', '.RAW', '.PRO', '.R', '_R', '.I', '_I', '.C', '_C', '.S', '_S', '.X', '_X', '#', '+'];
        const PREFIXES = ['', '#', '_'];
        const candidates = [];
        for (const p of PREFIXES)
            for (const s of SUFFIXES) {
                const c = `${p}${target}${s}`;
                if (c !== target && inventory.set.has(c))
                    candidates.push(c);
            }
        if (candidates.length) {
            candidates.sort((a, b) => a.length - b.length);
            const winner = candidates[0];
            const exact = inventory.list.find(s => s.toUpperCase() === winner);
            return exact ?? winner;
        }
        // Last resort: any instrument that CONTAINS the requested ticker (e.g. "XAUUSDpro").
        const contains = inventory.list.filter(s => s.toUpperCase().includes(target));
        if (contains.length === 1)
            return contains[0];
        if (contains.length > 1) {
            contains.sort((a, b) => a.length - b.length);
            return contains[0];
        }
        return requested;
    }
}
exports.TradeExecutor = TradeExecutor;
