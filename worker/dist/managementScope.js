"use strict";
/**
 * Scope resolution for channel management instructions (close half, modify SL, etc.).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReplyScopedManagement = isReplyScopedManagement;
exports.explicitMgmtSymbol = explicitMgmtSymbol;
exports.filterTradesBySymbolFilter = filterTradesBySymbolFilter;
exports.filterTradesByPlausibleMgmtLevels = filterTradesByPlausibleMgmtLevels;
exports.resolveNewestOpenSymbolTrades = resolveNewestOpenSymbolTrades;
exports.isMgmtEligibleTradeStatus = isMgmtEligibleTradeStatus;
exports.loadOpenTradesForManagement = loadOpenTradesForManagement;
exports.resolveChannelCweTargets = resolveChannelCweTargets;
exports.loadTradesForBasketAnchor = loadTradesForBasketAnchor;
exports.loadOpenTradesForChannelWideCwe = loadOpenTradesForChannelWideCwe;
exports.resolveChannelModifyTargets = resolveChannelModifyTargets;
exports.expandMgmtRowsToFullBaskets = expandMgmtRowsToFullBaskets;
exports.loadOpenTradesForSignalAcrossBrokers = loadOpenTradesForSignalAcrossBrokers;
const basketModFollowUp_1 = require("./basketModFollowUp");
const parallelPool_1 = require("./parallelPool");
const pipMath_1 = require("./pipMath");
const signalPip_1 = require("./signalPip");
const tradableSymbol_1 = require("./tradableSymbol");
const MAX_PLAUSIBLE_PIPS = 500;
/** Legacy gold mgmt used 500 × $0.10 = $50; keep the same price ceiling at cent pips. */
const METAL_MAX_MGMT_PRICE_DIST = 50;
function maxMgmtPriceDistance(symbol, pip) {
    if ((0, pipMath_1.classifySymbol)(symbol) === 'metal')
        return METAL_MAX_MGMT_PRICE_DIST;
    return MAX_PLAUSIBLE_PIPS * pip;
}
function isReplyScopedManagement(signal) {
    return Boolean(String(signal.reply_to_message_id ?? '').trim());
}
/** Symbol from instruction text only — never inherit from a parent signal. */
function explicitMgmtSymbol(parsed) {
    return (0, tradableSymbol_1.sanitizeParsedSymbol)(parsed.symbol);
}
function mgmtHasPriceLevels(parsed) {
    const hasSl = typeof parsed.sl === 'number' && Number.isFinite(parsed.sl) && parsed.sl > 0;
    const hasTp = (parsed.tp ?? []).some(t => typeof t === 'number' && Number.isFinite(t) && t > 0);
    return hasSl || hasTp;
}
function tradeMatchesSymbolFilter(trade, symbolFilter) {
    return (0, basketModFollowUp_1.symbolsCompatibleForBasket)(symbolFilter, trade.symbol);
}
function filterTradesBySymbolFilter(trades, symbolFilter) {
    const sym = symbolFilter?.trim();
    if (!sym)
        return trades;
    return trades.filter(t => tradeMatchesSymbolFilter(t, sym));
}
function normSymbolKey(sym) {
    return String(sym ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** Bucket open legs by compatible broker symbol. */
function groupTradesBySymbolBucket(trades) {
    const buckets = new Map();
    for (const tr of trades) {
        const key = normSymbolKey(tr.symbol);
        let hit = null;
        for (const existing of buckets.keys()) {
            if ((0, basketModFollowUp_1.symbolsCompatibleForBasket)(existing, tr.symbol)) {
                hit = existing;
                break;
            }
        }
        const k = hit ?? key;
        const list = buckets.get(k) ?? [];
        list.push(tr);
        buckets.set(k, list);
    }
    return buckets;
}
function referencePriceForBucket(rows) {
    for (const r of rows) {
        const ep = r.entry_price;
        if (typeof ep === 'number' && Number.isFinite(ep) && ep > 0)
            return ep;
    }
    return null;
}
function levelPlausibleForBucket(rows, parsed) {
    const ref = referencePriceForBucket(rows);
    if (ref == null)
        return false;
    const sample = rows[0];
    const pip = (0, signalPip_1.signalPipPrice)(sample?.symbol ?? parsed.symbol ?? 'EURUSD');
    if (!(pip > 0))
        return false;
    const maxDist = maxMgmtPriceDistance(sample?.symbol ?? parsed.symbol ?? 'EURUSD', pip);
    const isBuy = rows.every(r => String(r.direction).toLowerCase() === 'buy');
    const isSell = rows.every(r => String(r.direction).toLowerCase() === 'sell');
    if (!isBuy && !isSell)
        return false;
    const sl = typeof parsed.sl === 'number' && parsed.sl > 0 ? parsed.sl : null;
    const tp0 = (parsed.tp ?? []).find(t => typeof t === 'number' && t > 0);
    const levelOk = (level, kind) => {
        if (Math.abs(level - ref) > maxDist)
            return false;
        if (isBuy) {
            if (kind === 'sl')
                return level < ref;
            return level > ref;
        }
        if (kind === 'sl')
            return level > ref;
        return level < ref;
    };
    if (sl != null && !levelOk(sl, 'sl'))
        return false;
    if (tp0 != null && !levelOk(tp0, 'tp'))
        return false;
    return sl != null || tp0 != null;
}
/**
 * Keep trades whose symbol bucket can accept the parsed SL/TP levels.
 * Returns empty when no bucket matches.
 */
function filterTradesByPlausibleMgmtLevels(trades, parsed) {
    if (!trades.length || !mgmtHasPriceLevels(parsed))
        return [];
    const buckets = groupTradesBySymbolBucket(trades);
    const matched = [];
    for (const [, rows] of buckets) {
        if (levelPlausibleForBucket(rows, parsed)) {
            matched.push(...rows);
        }
    }
    return matched;
}
/** When plausibility fails, apply to the symbol of the most recently opened leg. */
function resolveNewestOpenSymbolTrades(trades) {
    if (!trades.length)
        return [];
    let newest = null;
    let newestTs = 0;
    for (const tr of trades) {
        const ts = tr.opened_at ? new Date(tr.opened_at).getTime() : 0;
        if (!newest || ts >= newestTs) {
            newest = tr;
            newestTs = ts;
        }
    }
    if (!newest)
        return [];
    const anchorSym = newest.symbol;
    return trades.filter(t => (0, basketModFollowUp_1.symbolsCompatibleForBasket)(anchorSym, t.symbol));
}
const MGMT_TRADE_SELECT = 'id,signal_id,broker_account_id,metaapi_order_id,symbol,direction,lot_size,status,sl,tp,entry_price,opened_at,cwe_close_price';
/** Active legs eligible for management (open + broker-pending strict entries). */
function isMgmtEligibleTradeStatus(status) {
    const s = String(status ?? '').toLowerCase();
    return s === 'open' || s === 'pending';
}
/** Per-broker row cap. Applied per broker (not shared) so a busy channel with
 *  many accounts never truncates coverage for later brokers. */
const MGMT_PER_BROKER_LIMIT = 500;
/** Run per-broker scoped queries in parallel once the account count crosses this. */
const MGMT_PER_BROKER_SCOPE_THRESHOLD = 4;
async function loadOpenTradesForManagement(supabase, args) {
    const { userId, channelId } = args;
    const brokerAccountIds = [...new Set(args.brokerAccountIds)];
    if (!channelId || !brokerAccountIds.length)
        return [];
    const { data: channelSignals } = await supabase
        .from('signals')
        .select('id')
        .eq('user_id', userId)
        .eq('channel_id', channelId)
        .limit(5000);
    const signalIds = (channelSignals ?? []).map((r) => r.id);
    // The three discovery queries (by telegram_channel_id, by channel signal_ids,
    // by attribution) for a given broker subset. Each query is scoped to the
    // subset so its row cap belongs to that subset alone.
    const loadForBrokers = async (brokerIds) => {
        const { data: byChannelCol } = await supabase
            .from('trades')
            .select(MGMT_TRADE_SELECT)
            .eq('user_id', userId)
            .in('broker_account_id', brokerIds)
            .in('status', ['open', 'pending'])
            .eq('telegram_channel_id', channelId)
            .order('opened_at', { ascending: true })
            .limit(MGMT_PER_BROKER_LIMIT);
        const { data: bySignalId } = signalIds.length
            ? await supabase
                .from('trades')
                .select(MGMT_TRADE_SELECT)
                .eq('user_id', userId)
                .in('broker_account_id', brokerIds)
                .in('status', ['open', 'pending'])
                .in('signal_id', signalIds)
                .order('opened_at', { ascending: true })
                .limit(MGMT_PER_BROKER_LIMIT)
            : { data: [] };
        const { data: attribRows } = await supabase
            .from('trade_channel_attributions')
            .select('trade_id')
            .eq('user_id', userId)
            .eq('channel_id', channelId)
            .in('broker_account_id', brokerIds)
            .limit(MGMT_PER_BROKER_LIMIT);
        const attribTradeIds = (attribRows ?? []).map((r) => r.trade_id).filter(Boolean);
        const { data: byAttribution } = attribTradeIds.length
            ? await supabase
                .from('trades')
                .select(MGMT_TRADE_SELECT)
                .eq('user_id', userId)
                .in('broker_account_id', brokerIds)
                .in('status', ['open', 'pending'])
                .in('id', attribTradeIds)
                .order('opened_at', { ascending: true })
                .limit(MGMT_PER_BROKER_LIMIT)
            : { data: [] };
        return [
            ...(byChannelCol ?? []),
            ...(bySignalId ?? []),
            ...(byAttribution ?? []),
        ];
    };
    // For many accounts, scope each broker independently in parallel so a single
    // shared row cap can't starve later brokers (the multi-broker partial-apply bug).
    const collected = brokerAccountIds.length >= MGMT_PER_BROKER_SCOPE_THRESHOLD
        ? (await (0, parallelPool_1.parallelMap)(brokerAccountIds, (0, parallelPool_1.mgmtBasketConcurrency)(), id => loadForBrokers([id]))).flat()
        : await loadForBrokers(brokerAccountIds);
    const merged = new Map();
    for (const row of collected) {
        if (row.status === 'pending') {
            const ticket = Number(row.metaapi_order_id);
            if (!Number.isFinite(ticket) || ticket <= 0)
                continue;
        }
        merged.set(row.id, row);
    }
    let rows = [...merged.values()];
    rows = filterTradesBySymbolFilter(rows, args.symbolFilter);
    return rows;
}
/** Channel-wide CWE without explicit symbol: active basket = newest open symbol bucket. */
function resolveChannelCweTargets(trades, symbolFilter) {
    const filtered = filterTradesBySymbolFilter(trades, symbolFilter);
    if (symbolFilter?.trim())
        return filtered;
    return resolveNewestOpenSymbolTrades(filtered);
}
async function loadTradesForBasketAnchor(supabase, args) {
    const { data } = await supabase
        .from('trades')
        .select(MGMT_TRADE_SELECT)
        .eq('user_id', args.userId)
        .eq('signal_id', args.anchorSignalId)
        .in('broker_account_id', args.brokerAccountIds)
        .in('status', ['open', 'pending'])
        .order('opened_at', { ascending: true })
        .limit(500);
    return (data ?? []);
}
/**
 * Channel-wide close-worse-entries: load open legs for the active basket on the channel.
 * Uses the standard channel trade loader first, then falls back to newest basket anchor
 * by signal_id (same resolution reply-scoped CWE uses, without requiring a parent signal).
 */
async function loadOpenTradesForChannelWideCwe(supabase, args) {
    const scoped = resolveChannelCweTargets(await loadOpenTradesForManagement(supabase, args), args.symbolFilter);
    if (scoped.length)
        return scoped;
    const { data: openRows } = await supabase
        .from('trades')
        .select(`${MGMT_TRADE_SELECT},telegram_channel_id`)
        .eq('user_id', args.userId)
        .in('broker_account_id', args.brokerAccountIds)
        .in('status', ['open', 'pending'])
        .order('opened_at', { ascending: false })
        .limit(300);
    const candidates = (openRows ?? []);
    if (!candidates.length)
        return [];
    const signalIds = [...new Set(candidates.map(t => t.signal_id).filter(Boolean))];
    const channelSignalIds = new Set();
    if (signalIds.length) {
        const { data: sigRows } = await supabase
            .from('signals')
            .select('id, channel_id')
            .in('id', signalIds);
        for (const s of sigRows ?? []) {
            if (s.channel_id === args.channelId) {
                channelSignalIds.add(s.id);
            }
        }
    }
    const { data: attribRows } = await supabase
        .from('trade_channel_attributions')
        .select('trade_id')
        .eq('user_id', args.userId)
        .eq('channel_id', args.channelId)
        .in('broker_account_id', args.brokerAccountIds)
        .limit(500);
    const attribTradeIds = new Set((attribRows ?? []).map((r) => r.trade_id).filter(Boolean));
    const onChannel = candidates.filter(t => t.telegram_channel_id === args.channelId
        || channelSignalIds.has(t.signal_id)
        || attribTradeIds.has(t.id));
    if (!onChannel.length)
        return [];
    const symFilter = args.symbolFilter?.trim();
    const filtered = symFilter
        ? onChannel.filter(t => tradeMatchesSymbolFilter(t, symFilter))
        : onChannel;
    if (!filtered.length)
        return [];
    const anchorSignalId = filtered[0].signal_id;
    const basketRows = await loadTradesForBasketAnchor(supabase, {
        userId: args.userId,
        brokerAccountIds: args.brokerAccountIds,
        anchorSignalId,
    });
    return resolveChannelCweTargets(basketRows, args.symbolFilter);
}
/**
 * Channel-wide modify without explicit symbol: apply to every open symbol bucket
 * whose legs accept the parsed SL/TP levels (all matching accounts/baskets).
 * Falls back to the newest open symbol when levels are ambiguous.
 */
function resolveChannelModifyTargets(trades, parsed) {
    if (!trades.length)
        return [];
    if (!mgmtHasPriceLevels(parsed)) {
        return resolveNewestOpenSymbolTrades(trades);
    }
    const plausibleAll = filterTradesByPlausibleMgmtLevels(trades, parsed);
    if (plausibleAll.length)
        return plausibleAll;
    const scoped = resolveNewestOpenSymbolTrades(trades);
    return scoped;
}
/**
 * Ensure every open leg on each touched basket anchor is included — channel-wide
 * loaders can return a subset when symbol filters or attribution lag behind fills.
 */
async function expandMgmtRowsToFullBaskets(supabase, args) {
    if (!args.rows.length)
        return [];
    const merged = new Map();
    for (const tr of args.rows)
        merged.set(tr.id, tr);
    const anchors = new Map();
    for (const tr of args.rows) {
        anchors.set(`${tr.broker_account_id}|${tr.signal_id}`, {
            brokerAccountId: tr.broker_account_id,
            anchorSignalId: tr.signal_id,
        });
    }
    await Promise.all([...anchors.values()].map(async ({ brokerAccountId, anchorSignalId }) => {
        const basketRows = await loadTradesForBasketAnchor(supabase, {
            userId: args.userId,
            brokerAccountIds: [brokerAccountId],
            anchorSignalId,
        });
        for (const tr of basketRows)
            merged.set(tr.id, tr);
    }));
    return [...merged.values()].sort((a, b) => {
        const ta = a.opened_at ? new Date(a.opened_at).getTime() : 0;
        const tb = b.opened_at ? new Date(b.opened_at).getTime() : 0;
        return ta - tb;
    });
}
/**
 * Load every open/pending leg for a single signal across all linked brokers.
 *
 * Unlike the channel-wide loader, this is anchored to one `signal_id`, so it can
 * never truncate broker coverage on busy channels (a single entry basket across
 * 12 brokers is far below any row cap). Returns explicit found/missing broker
 * lists so callers can heal (reconcile) brokers that have no legs in scope.
 */
async function loadOpenTradesForSignalAcrossBrokers(supabase, args) {
    const uniqueBrokers = [...new Set(args.brokerAccountIds)];
    if (!args.signalId || !uniqueBrokers.length) {
        return { rows: [], brokersFound: [], brokersMissing: uniqueBrokers };
    }
    // Anchoring on signal_id returns all legs for this signal across every broker
    // in one query (range/layer legs share the anchor signal_id).
    const rows = await loadTradesForBasketAnchor(supabase, {
        userId: args.userId,
        brokerAccountIds: uniqueBrokers,
        anchorSignalId: args.signalId,
    });
    const found = new Set();
    for (const r of rows)
        found.add(r.broker_account_id);
    const brokersMissing = uniqueBrokers.filter(id => !found.has(id));
    return { rows, brokersFound: [...found], brokersMissing };
}
