"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectPrewarmSymbolsForBroker = collectPrewarmSymbolsForBroker;
exports.prewarmSymbolsEnabled = prewarmSymbolsEnabled;
exports.prewarmBrokerCaches = prewarmBrokerCaches;
exports.sessionHeartbeatTick = sessionHeartbeatTick;
exports.reconnectCachedBrokers = reconnectCachedBrokers;
exports.pingBrokerSession = pingBrokerSession;
exports.symbolCacheKeepaliveTick = symbolCacheKeepaliveTick;
exports.markBrokerSessionDown = markBrokerSessionDown;
exports.markBrokerSessionRecovered = markBrokerSessionRecovered;
exports.ensureBrokerSession = ensureBrokerSession;
exports.ensureBrokerSessionLiveFast = ensureBrokerSessionLiveFast;
exports.brokersWarmForLiveEntry = brokersWarmForLiveEntry;
exports.prewarmForDispatch = prewarmForDispatch;
exports.prewarmBrokersForLiveEntry = prewarmBrokersForLiveEntry;
exports.getSymbolParams = getSymbolParams;
exports.refreshSymbolParams = refreshSymbolParams;
exports.getSymbolList = getSymbolList;
exports.fetchSymbolList = fetchSymbolList;
exports.resolveBrokerSymbolFromInventory = resolveBrokerSymbolFromInventory;
exports.resolveBrokerSymbolForLiveEntry = resolveBrokerSymbolForLiveEntry;
exports.resolveBrokerSymbol = resolveBrokerSymbol;
const fxsocketClient_1 = require("../fxsocketClient");
const brokerConnectionStatus_1 = require("../brokerConnectionStatus");
const brokerTerminalHealth_1 = require("../brokerTerminalHealth");
const helpers_1 = require("./helpers");
const derivSymbols_1 = require("../derivSymbols");
const brokerSymbolDecoration_1 = require("./brokerSymbolDecoration");
const types_1 = require("./types");
const HEARTBEAT_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.BROKER_HEARTBEAT_CONCURRENCY ?? 2) || 2));
const HEARTBEAT_BATCH_GAP_MS = Math.max(0, Math.min(2000, Number(process.env.BROKER_HEARTBEAT_BATCH_GAP_MS ?? 250) || 250));
const SYMBOL_KEEPALIVE_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SYMBOL_KEEPALIVE_CONCURRENCY ?? 2) || 2));
const symbolInventoryReadyHandled = new Set();
const SYMBOL_AUTO_MATCH_PROBES = ['EURUSD', 'XAUUSD', 'GBPUSD', 'BTCUSD'];
function findBrokerBySessionUuid(ctx, uuid) {
    for (const broker of ctx.brokersById.values()) {
        if ((0, helpers_1.brokerSessionUuid)(broker) === uuid)
            return broker;
    }
    return undefined;
}
async function onBrokerSymbolInventoryReady(ctx, uuid, inventory) {
    if (symbolInventoryReadyHandled.has(uuid))
        return;
    const broker = findBrokerBySessionUuid(ctx, uuid);
    if (!broker || broker.connection_status !== 'connected')
        return;
    symbolInventoryReadyHandled.add(uuid);
    await (0, brokerSymbolDecoration_1.clearLegacySymbolDecorationIfPresent)(ctx.supabase, broker);
    const parts = [];
    for (const probe of SYMBOL_AUTO_MATCH_PROBES) {
        const resolved = resolveBrokerSymbolFromInventory(ctx, inventory, probe);
        if (resolved.toUpperCase() !== probe) {
            parts.push(`${probe}→${resolved}`);
        }
    }
    if (parts.length > 0) {
        console.log(`[tradeExecutor] symbol auto-match broker=${broker.id} ${parts.join(' ')}`);
    }
}
function activeBrokersForHeartbeat(ctx) {
    return [...ctx.brokersById.values()].filter(b => b.is_active && (0, helpers_1.brokerSessionUuid)(b));
}
function collectPrewarmSymbolsForBroker(broker) {
    const manual = (broker.manual_settings ?? {});
    const symbols = (0, helpers_1.parseSymbolToTradeList)(manual.symbol_to_trade);
    const base = symbols.length > 0 ? symbols : ['XAUUSD', 'EURUSD'];
    const out = new Set();
    for (const sym of base) {
        out.add(sym);
        out.add((0, helpers_1.applySymbolMapping)(sym, broker).symbol);
    }
    return [...out];
}
function prewarmBrokerSymbolCaches(ctx, broker) {
    const uuid = (0, helpers_1.brokerSessionUuid)(broker);
    if (!uuid)
        return;
    void ctx.getSymbolList(uuid).catch(() => null);
    for (const sym of collectPrewarmSymbolsForBroker(broker)) {
        void ctx.getSymbolParams(uuid, sym).catch(() => null);
    }
}
async function pingBrokerSessionInner(ctx, broker, api, uuid, opts) {
    // No network keepSessionAlive — FxSocket terminals are self-hosted and stay up.
    void api;
    void opts;
    if (ctx.sessionOrderBlocked.has(broker.id))
        return false;
    ctx.sessionPingAt.set(uuid, Date.now());
    return true;
}
function prewarmSymbolsEnabled(ctx) {
    const v = String(process.env.EXECUTOR_PREWARM_SYMBOLS ?? 'true').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}
async function prewarmBrokerCaches(ctx) {
    if (!ctx.prewarmSymbolsEnabled() || !(0, fxsocketClient_1.hasFxsocketConfigured)())
        return;
    for (const row of ctx.brokersById.values()) {
        const uuid = (0, helpers_1.brokerSessionUuid)(row);
        if (!uuid)
            continue;
        prewarmBrokerSymbolCaches(ctx, row);
    }
}
async function sessionHeartbeatTick(ctx) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return;
    const brokers = activeBrokersForHeartbeat(ctx);
    if (!brokers.length)
        return;
    for (let i = 0; i < brokers.length; i += HEARTBEAT_CONCURRENCY) {
        if (i > 0 && HEARTBEAT_BATCH_GAP_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, HEARTBEAT_BATCH_GAP_MS));
        }
        const batch = brokers.slice(i, i + HEARTBEAT_CONCURRENCY);
        await Promise.all(batch.map(async (broker) => {
            const uuid = (0, helpers_1.brokerSessionUuid)(broker);
            if (!uuid)
                return;
            const api = ctx.apiFor(broker);
            if (!api)
                return;
            await pingBrokerSessionInner(ctx, broker, api, uuid);
        }));
    }
}
async function reconnectCachedBrokers(_ctx) {
    /* FxSocket manages terminal lifecycle */
}
async function pingBrokerSession(ctx, row) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)() || !row.is_active)
        return;
    const uuid = (0, helpers_1.brokerSessionUuid)(row);
    if (!uuid)
        return;
    const api = ctx.apiFor(row);
    if (!api)
        return;
    await pingBrokerSessionInner(ctx, row, api, uuid, { force: true });
}
async function symbolCacheKeepaliveTick(ctx) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return;
    if (!ctx.prewarmSymbolsEnabled())
        return;
    const uuidsWithList = [...ctx.symbolListCache.keys()];
    for (let i = 0; i < uuidsWithList.length; i += SYMBOL_KEEPALIVE_CONCURRENCY) {
        const batch = uuidsWithList.slice(i, i + SYMBOL_KEEPALIVE_CONCURRENCY);
        await Promise.all(batch.map(async (uuid) => {
            try {
                const fresh = await ctx.fetchSymbolList(uuid);
                if (fresh)
                    ctx.symbolListCache.set(uuid, fresh);
            }
            catch { /* best-effort */ }
        }));
        if (i + SYMBOL_KEEPALIVE_CONCURRENCY < uuidsWithList.length && HEARTBEAT_BATCH_GAP_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, HEARTBEAT_BATCH_GAP_MS));
        }
    }
    const paramsKeys = [...ctx.symbolCache.keys()];
    for (let i = 0; i < paramsKeys.length; i += SYMBOL_KEEPALIVE_CONCURRENCY) {
        const batch = paramsKeys.slice(i, i + SYMBOL_KEEPALIVE_CONCURRENCY);
        await Promise.all(batch.map(async (key) => {
            const sepIdx = key.indexOf(':');
            if (sepIdx < 0)
                return;
            const uuid = key.slice(0, sepIdx);
            const symbol = key.slice(sepIdx + 1);
            if (!(0, helpers_1.isMtUuid)(uuid) || !symbol)
                return;
            const api = ctx.apiForUuid(uuid);
            if (!api)
                return;
            try {
                const p = await api.symbolParams(uuid, symbol);
                const n = (0, fxsocketClient_1.normalizeSymbolParams)(p);
                ctx.symbolCache.set(key, {
                    digits: n.digits ?? 5,
                    point: n.point ?? 0.00001,
                    minLot: n.minLot ?? 0.01,
                    maxLot: n.maxLot ?? 100,
                    lotStep: n.lotStep ?? 0.01,
                    contractSize: Number.isFinite(n.contractSize) && (n.contractSize ?? 0) > 0 ? Number(n.contractSize) : null,
                    stopsLevel: Math.max(0, n.stopsLevel ?? 0),
                    freezeLevel: Math.max(0, n.freezeLevel ?? 0),
                    loadedAt: Date.now(),
                });
            }
            catch { /* best-effort */ }
        }));
        if (i + SYMBOL_KEEPALIVE_CONCURRENCY < paramsKeys.length && HEARTBEAT_BATCH_GAP_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, HEARTBEAT_BATCH_GAP_MS));
        }
    }
}
async function markBrokerSessionDown(ctx, broker, uuid, reason) {
    ctx.sessionPingAt.delete(uuid);
    ctx.sessionOrderBlocked.add(broker.id);
    console.warn(`[tradeExecutor] broker ${broker.id} session down: ${reason}`);
    broker.connection_status = 'error';
    await (0, brokerConnectionStatus_1.writeBrokerConnectionStatus)(ctx.supabase, broker.id, 'error', { rawError: reason });
    await (0, brokerTerminalHealth_1.writeBrokerTerminalUnhealthy)(ctx.supabase, broker.id, { force: true });
}
/**
 * Symmetric counterpart to markBrokerSessionDown. The worker is the sole writer
 * of connection_status but otherwise only ever degrades it to 'error'; without
 * this, a row stays stuck 'error' forever after a transient heartbeat blip even
 * once the session recovers. Called from every heartbeat success path.
 */
async function markBrokerSessionRecovered(ctx, broker) {
    // Always write connected (force) so sticky connection_error_kind left by
    // edge refresh_summary / partial patches cannot survive a healthy heartbeat.
    broker.connection_status = 'connected';
    await (0, brokerConnectionStatus_1.writeBrokerConnectionStatus)(ctx.supabase, broker.id, 'connected', { force: true });
}
async function ensureBrokerSession(ctx, api, uuid, broker, opts) {
    // FxSocket self-hosted terminals need no proactive checkConnect. Only skip when
    // a prior real OrderSend disconnect blocked this broker.
    void api;
    void opts;
    if (ctx.sessionOrderBlocked.has(broker.id))
        return false;
    ctx.sessionPingAt.set(uuid, Date.now());
    return true;
}
async function ensureBrokerSessionLiveFast(ctx, api, uuid, broker) {
    void api;
    if (ctx.sessionOrderBlocked.has(broker.id))
        return false;
    ctx.sessionPingAt.set(uuid, Date.now());
    return true;
}
function brokersWarmForLiveEntry(ctx, brokers, signalSymbol) {
    if (!brokers.length)
        return true;
    const now = Date.now();
    for (const broker of brokers) {
        const uuid = (0, helpers_1.brokerSessionUuid)(broker);
        if (!uuid)
            continue;
        if (ctx.sessionOrderBlocked.has(broker.id))
            return false;
        const lastPing = ctx.sessionPingAt.get(uuid) ?? 0;
        if (now - lastPing >= types_1.SESSION_PING_MIN_INTERVAL_MS)
            return false;
        const symbolList = ctx.symbolListCache.get(uuid);
        if (!symbolList || now - symbolList.loadedAt >= types_1.SYMBOL_LIST_TTL_MS)
            return false;
        const mapping = (0, helpers_1.applySymbolMapping)(signalSymbol, broker);
        const requested = mapping.symbol;
        const key = `${uuid}:${requested.toUpperCase()}`;
        const params = ctx.symbolCache.get(key);
        if (!params || now - params.loadedAt >= types_1.SYMBOL_CACHE_TTL_MS)
            return false;
    }
    return true;
}
function prewarmForDispatch(ctx, row) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return;
    const parsed = row.parsed_data;
    const signalSymbol = parsed?.symbol;
    if (!signalSymbol)
        return;
    const brokers = ctx.brokersByUser.get(row.user_id) ?? [];
    if (!brokers.length)
        return;
    for (const broker of brokers) {
        const uuid = (0, helpers_1.brokerSessionUuid)(broker);
        if (!uuid)
            continue;
        const api = ctx.apiFor(broker);
        if (!api)
            continue;
        const mapping = (0, helpers_1.applySymbolMapping)(signalSymbol, broker);
        const requested = mapping.symbol;
        void ctx.ensureBrokerSessionLiveFast(api, uuid, broker);
        void ctx.getSymbolList(uuid).catch(() => null);
        void ctx.getSymbolParams(uuid, requested).catch(() => null);
    }
}
async function prewarmBrokersForLiveEntry(ctx, brokers, signalSymbol) {
    await Promise.all(brokers.map(async (broker) => {
        const uuid = (0, helpers_1.brokerSessionUuid)(broker);
        if (!uuid)
            return;
        const api = ctx.apiFor(broker);
        if (!api)
            return;
        const mapping = (0, helpers_1.applySymbolMapping)(signalSymbol, broker);
        const requested = mapping.symbol;
        await Promise.all([
            ctx.ensureBrokerSessionLiveFast(api, uuid, broker),
            ctx.getSymbolList(uuid).catch(() => null),
            ctx.getSymbolParams(uuid, requested).catch(() => null),
        ]);
    }));
}
async function getSymbolParams(ctx, uuid, symbol) {
    const key = `${uuid}:${symbol.toUpperCase()}`;
    const cached = ctx.symbolCache.get(key);
    const now = Date.now();
    // Stale-while-revalidate: if we have ANY cached value, return it
    // immediately and kick off a background refresh when stale. The live
    // entry hot path therefore never waits on a broker round-trip after the
    // first signal for a symbol.
    if (cached) {
        const age = now - cached.loadedAt;
        if (age >= types_1.SYMBOL_CACHE_STALE_MS && age < types_1.SYMBOL_CACHE_TTL_MS) {
            void ctx.refreshSymbolParams(uuid, symbol, key);
        }
        if (age < types_1.SYMBOL_CACHE_TTL_MS)
            return cached;
    }
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return null;
    return ctx.refreshSymbolParams(uuid, symbol, key);
}
async function refreshSymbolParams(ctx, uuid, symbol, key) {
    const cacheKey = key ?? `${uuid}:${symbol.toUpperCase()}`;
    const existing = ctx.symbolParamsInflight.get(cacheKey);
    if (existing)
        return existing;
    const api = ctx.apiForUuid(uuid);
    if (!api)
        return null;
    const promise = (async () => {
        try {
            const p = await api.symbolParams(uuid, symbol);
            const n = (0, fxsocketClient_1.normalizeSymbolParams)(p);
            const entry = {
                digits: n.digits ?? 5,
                point: n.point ?? 0.00001,
                minLot: n.minLot ?? 0.01,
                maxLot: n.maxLot ?? 100,
                lotStep: n.lotStep ?? 0.01,
                contractSize: Number.isFinite(n.contractSize) && (n.contractSize ?? 0) > 0 ? Number(n.contractSize) : null,
                stopsLevel: Math.max(0, n.stopsLevel ?? 0),
                freezeLevel: Math.max(0, n.freezeLevel ?? 0),
                loadedAt: Date.now(),
            };
            // First-time-per-symbol diagnostic so we can confirm we actually see the
            // broker's stops/freeze levels (not silent zeros from a casing mismatch).
            if (!ctx.symbolCache.has(cacheKey)) {
                console.log(`[tradeExecutor] symbol params loaded uuid=${uuid} symbol=${symbol} digits=${entry.digits} point=${entry.point} contractSize=${entry.contractSize ?? 'default'} stopsLevel=${entry.stopsLevel} freezeLevel=${entry.freezeLevel} minLot=${entry.minLot} lotStep=${entry.lotStep}`);
            }
            ctx.symbolCache.set(cacheKey, entry);
            return entry;
        }
        catch (e) {
            console.warn(`[tradeExecutor] /SymbolParams failed uuid=${uuid} symbol=${symbol}:`, e instanceof Error ? e.message : e);
            return null;
        }
        finally {
            ctx.symbolParamsInflight.delete(cacheKey);
        }
    })();
    ctx.symbolParamsInflight.set(cacheKey, promise);
    return promise;
}
async function getSymbolList(ctx, uuid) {
    const cached = ctx.symbolListCache.get(uuid);
    const now = Date.now();
    if (cached) {
        const age = now - cached.loadedAt;
        if (age >= types_1.SYMBOL_CACHE_STALE_MS && age < types_1.SYMBOL_LIST_TTL_MS) {
            if (!ctx.symbolListInflight.has(uuid)) {
                const refresh = ctx.fetchSymbolList(uuid).finally(() => {
                    ctx.symbolListInflight.delete(uuid);
                });
                ctx.symbolListInflight.set(uuid, refresh);
            }
        }
        if (age < types_1.SYMBOL_LIST_TTL_MS)
            return cached;
    }
    const inflight = ctx.symbolListInflight.get(uuid);
    if (inflight)
        return inflight;
    const fetchPromise = ctx.fetchSymbolList(uuid).finally(() => {
        ctx.symbolListInflight.delete(uuid);
    });
    ctx.symbolListInflight.set(uuid, fetchPromise);
    return fetchPromise;
}
async function fetchSymbolList(ctx, uuid) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return null;
    const api = ctx.apiForUuid(uuid);
    if (!api)
        return null;
    try {
        const raw = await api.symbols(uuid);
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
        ctx.symbolListCache.set(uuid, entry);
        void onBrokerSymbolInventoryReady(ctx, uuid, entry).catch(err => {
            console.warn(`[tradeExecutor] symbol inventory ready hook failed uuid=${uuid}:`, err instanceof Error ? err.message : err);
        });
        return entry;
    }
    catch {
        return null;
    }
}
function resolveBrokerSymbolFromInventory(ctx, inventory, requested, opts) {
    const target = requested.toUpperCase();
    // Deriv synthetics: the canonical code (R_75, BOOM1000…) rarely matches the
    // broker's display name (`Volatility 75 Index`), so resolve via the Deriv
    // alias map before the generic FX suffix/contains heuristics. The synthetic
    // gate is broker-safe — only canonical synthetic codes ever reach here.
    if ((0, derivSymbols_1.isDerivSyntheticSymbol)(target)) {
        const brokerSymbol = (0, derivSymbols_1.resolveDerivCanonicalToBrokerSymbol)(target, inventory.list);
        if (brokerSymbol)
            return brokerSymbol;
        console.warn(`[tradeExecutor] Deriv synthetic ${requested} not found in broker /Symbols list`);
        return requested;
    }
    if (opts?.userDecorated === true) {
        if (inventory.set.has(target)) {
            const exact = inventory.list.find(s => s.toUpperCase() === target);
            return exact ?? requested;
        }
        console.warn(`[tradeExecutor] user-decorated symbol not in broker /Symbols list: ${requested}`);
        return requested;
    }
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
    const contains = inventory.list.filter(s => s.toUpperCase().includes(target));
    if (contains.length === 1)
        return contains[0];
    if (contains.length > 1) {
        contains.sort((a, b) => a.length - b.length);
        return contains[0];
    }
    return requested;
}
async function resolveBrokerSymbolForLiveEntry(ctx, uuid, requested, opts) {
    const cached = ctx.symbolListCache.get(uuid);
    if (cached && (Date.now() - cached.loadedAt) < types_1.SYMBOL_LIST_TTL_MS) {
        return ctx.resolveBrokerSymbolFromInventory(cached, requested, opts);
    }
    const inventory = await ctx.getSymbolList(uuid);
    if (!inventory)
        return requested;
    return ctx.resolveBrokerSymbolFromInventory(inventory, requested, opts);
}
async function resolveBrokerSymbol(ctx, uuid, requested, opts) {
    const inventory = await ctx.getSymbolList(uuid);
    if (!inventory)
        return requested;
    return ctx.resolveBrokerSymbolFromInventory(inventory, requested, opts);
}
