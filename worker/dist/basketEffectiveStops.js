"use strict";
/**
 * Single source of truth for open-basket SL/TP authority (anchor vs adjust vs channel memory).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLatestMgmtModifySl = void 0;
exports.unanimousLegSl = unanimousLegSl;
exports.mostProtectiveOpenLegSl = mostProtectiveOpenLegSl;
exports.mergeWithProtectiveLegSl = mergeWithProtectiveLegSl;
exports.isSlMoreProtective = isSlMoreProtective;
exports.resolveEffectiveStoplossPriority = resolveEffectiveStoplossPriority;
exports.findLatestMgmtSlAdjustment = findLatestMgmtSlAdjustment;
exports.latestAutoBreakevenAt = latestAutoBreakevenAt;
exports.resolveEffectiveBasketStops = resolveEffectiveBasketStops;
exports.logEffectiveBasketStops = logEffectiveBasketStops;
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const basketModFollowUp_1 = require("./basketModFollowUp");
const rangeBasketTpSync_1 = require("./rangeBasketTpSync");
const basketTargetStore_1 = require("./basketTargetStore");
const MGMT_SL_ACTIONS = new Set(['modify', 'breakeven', 'partial_breakeven']);
function sanitizeLevel(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
function inferIsBuy(familyTrades) {
    const dir = String(familyTrades?.[0]?.direction ?? 'buy').toLowerCase();
    return dir !== 'sell';
}
function unanimousLegSl(familyTrades) {
    if (!familyTrades?.length)
        return null;
    const levels = new Set();
    for (const tr of familyTrades) {
        const sl = sanitizeLevel(tr.sl);
        if (sl <= 0)
            return null;
        levels.add(sl);
    }
    if (levels.size !== 1)
        return null;
    return [...levels][0];
}
/** Highest SL for buys / lowest for sells among open legs (breakeven-tightened legs). */
function mostProtectiveOpenLegSl(familyTrades, isBuy) {
    if (!familyTrades?.length)
        return null;
    let best = null;
    for (const tr of familyTrades) {
        const sl = sanitizeLevel(tr.sl);
        if (sl <= 0)
            continue;
        if (best == null)
            best = sl;
        else if (isBuy)
            best = Math.max(best, sl);
        else
            best = Math.min(best, sl);
    }
    return best;
}
function mergeWithProtectiveLegSl(resolvedSl, protectiveSl, isBuy) {
    if (protectiveSl == null || protectiveSl <= 0)
        return resolvedSl;
    if (resolvedSl <= 0)
        return protectiveSl;
    return isBuy ? Math.max(resolvedSl, protectiveSl) : Math.min(resolvedSl, protectiveSl);
}
/** True when `currentSl` is tighter than `targetSl` for the trade direction. */
function isSlMoreProtective(currentSl, targetSl, isBuy, epsilon = 1e-8) {
    if (currentSl <= 0 || targetSl <= 0)
        return false;
    if (isBuy)
        return currentSl > targetSl + epsilon;
    return currentSl < targetSl - epsilon;
}
/** Pure SL priority for unit tests. */
function resolveEffectiveStoplossPriority(args) {
    const target = args.basketTargetSl != null && args.basketTargetSl > 0 ? args.basketTargetSl : null;
    if (target != null)
        return { stoploss: target, source: 'basket_target' };
    const mgmt = args.mgmtSl != null && args.mgmtSl > 0 ? args.mgmtSl : null;
    if (mgmt != null)
        return { stoploss: mgmt, source: 'mgmt_signal' };
    const channel = args.channelSl != null && args.channelSl > 0 ? args.channelSl : null;
    if (channel != null)
        return { stoploss: channel, source: 'channel_memory' };
    const anchor = args.anchorSl > 0 ? args.anchorSl : 0;
    const consensus = args.legConsensus != null && args.legConsensus > 0 ? args.legConsensus : null;
    if (consensus != null && (anchor <= 0 || consensus !== anchor)) {
        return { stoploss: consensus, source: 'leg_consensus' };
    }
    return { stoploss: anchor, source: anchor > 0 ? 'anchor' : 'anchor' };
}
async function findLatestMgmtSlAdjustment(supabase, args) {
    const { data: candidates, error } = await supabase
        .from('signals')
        .select('id, parsed_data, created_at')
        .eq('user_id', args.userId)
        .eq('channel_id', args.channelId)
        .in('status', ['parsed', 'executed'])
        .gte('created_at', args.basketCreatedAt)
        .order('created_at', { ascending: false })
        .limit(60);
    if (error) {
        console.warn(`[effectiveStops] mgmt signal scan failed: ${error.message}`);
        return null;
    }
    // Candidates are newest-first. The newest management action determines which
    // instruction is authoritative. A breakeven message carries no price (sl=null),
    // so we must track it explicitly: an older "Adjust SL" must NOT override a
    // newer breakeven (that would revert the basket off breakeven).
    let newestMgmtAction = null;
    let priceAdjust = null;
    for (const row of candidates ?? []) {
        const parsed = row.parsed_data;
        if (!parsed?.action)
            continue;
        const action = String(parsed.action).toLowerCase();
        if (!MGMT_SL_ACTIONS.has(action))
            continue;
        if (!(0, basketModFollowUp_1.mgmtSignalMatchesBasketSymbol)(parsed, args.symbol))
            continue;
        if (newestMgmtAction == null)
            newestMgmtAction = action;
        if (priceAdjust == null && action === 'modify') {
            const sl = sanitizeLevel(parsed.sl);
            if (sl > 0) {
                priceAdjust = {
                    sl,
                    signalId: String(row.id),
                    tpLevels: (0, rangeBasketTpSync_1.coercePositiveTpLevels)(parsed.tp),
                    createdAt: row.created_at ?? null,
                };
            }
        }
        if (newestMgmtAction != null && priceAdjust != null)
            break;
    }
    if (!priceAdjust)
        return null;
    return {
        ...priceAdjust,
        latestActionIsBreakeven: newestMgmtAction === 'breakeven' || newestMgmtAction === 'partial_breakeven',
    };
}
/** Newest auto-breakeven timestamp across open legs (autoManagementMonitor sets auto_be_applied_at). */
function latestAutoBreakevenAt(familyTrades) {
    if (!familyTrades?.length)
        return null;
    let latest = null;
    let latestIso = null;
    for (const tr of familyTrades) {
        const at = tr.auto_be_applied_at;
        if (!at)
            continue;
        const t = Date.parse(at);
        if (!Number.isFinite(t))
            continue;
        if (latest == null || t > latest) {
            latest = t;
            latestIso = at;
        }
    }
    return latestIso;
}
/** @deprecated Use findLatestMgmtSlAdjustment */
exports.findLatestMgmtModifySl = findLatestMgmtSlAdjustment;
async function resolveEffectiveBasketStops(args) {
    const anchorSl = sanitizeLevel(args.anchorParsed.sl);
    let tpLevels = (0, rangeBasketTpSync_1.coercePositiveTpLevels)(args.anchorParsed.tp);
    const isBuy = inferIsBuy(args.familyTrades);
    // Auto-breakeven (autoManagementMonitor) tightens legs per-leg WITHOUT a
    // signal/channel memory/basket-target write — it only stamps
    // trades.auto_be_applied_at. Treat it as a first-class management action for
    // recency so a stale channel instruction cannot revert it after a TP hit.
    const autoBeAt = latestAutoBreakevenAt(args.familyTrades);
    // Authoritative per-basket target ("evolving signal"): the latest recorded
    // channel-wide instruction (entry seed / adjust / breakeven). When present it
    // wins for SL and TP and removes the recency heuristics below — UNLESS an
    // auto-breakeven happened after it was written, in which case the (per-leg)
    // auto-BE is newer and the protective merge must preserve it. Absent (older
    // baskets) -> fall back to mgmt-signal scan + channel memory + anchor.
    let basketTargetSl = null;
    let tpFromTarget = false;
    if (args.brokerAccountId) {
        const target = await (0, basketTargetStore_1.loadBasketSlTpTarget)(args.supabase, args.brokerAccountId, args.anchorSignalId);
        if (target) {
            const targetAt = target.instructionAt ?? target.updatedAt;
            const autoBeNewerThanTarget = autoBeAt != null
                && targetAt != null
                && Date.parse(autoBeAt) > Date.parse(targetAt);
            if (!autoBeNewerThanTarget && target.stoploss != null && target.stoploss > 0) {
                basketTargetSl = target.stoploss;
            }
            if (target.tpLevels.length > 0) {
                tpLevels = target.tpLevels;
                tpFromTarget = true;
            }
        }
    }
    let mgmtSl = null;
    let sourceSignalId;
    if (args.channelId && args.basketCreatedAt) {
        const mgmt = await findLatestMgmtSlAdjustment(args.supabase, {
            userId: args.userId,
            channelId: args.channelId,
            basketCreatedAt: args.basketCreatedAt,
            symbol: args.symbol,
        });
        if (mgmt) {
            // The latest management instruction wins. A breakeven that happened AFTER
            // the last "Adjust SL" — whether a channel breakeven signal OR an auto-BE
            // on the legs — must not be overridden by that stale adjust. TP authority
            // still follows the latest Adjust (unless the basket target already set it).
            if (mgmt.tpLevels.length && !tpFromTarget)
                tpLevels = mgmt.tpLevels;
            const autoBeNewerThanAdjust = autoBeAt != null
                && mgmt.createdAt != null
                && Date.parse(autoBeAt) > Date.parse(mgmt.createdAt);
            const breakevenIsLatest = mgmt.latestActionIsBreakeven || autoBeNewerThanAdjust;
            if (!breakevenIsLatest) {
                mgmtSl = mgmt.sl;
                sourceSignalId = mgmt.signalId;
            }
        }
    }
    let channelSl = null;
    let channelParams = null;
    if (args.channelId) {
        channelParams = await (0, channelActiveTradeParams_1.loadChannelActiveTradeParamsForSymbol)(args.supabase, args.userId, args.channelId, args.symbol);
        if (channelParams && args.basketCreatedAt && (0, channelActiveTradeParams_1.channelParamsPredateBasket)(channelParams, args.basketCreatedAt)) {
            channelParams = null;
        }
        else if (channelParams) {
            channelSl = channelParams.stoploss != null ? sanitizeLevel(channelParams.stoploss) : null;
            if (channelParams.tpLevels.length > 0 && !mgmtSl && !tpFromTarget) {
                tpLevels = [...channelParams.tpLevels];
            }
        }
    }
    const legConsensus = unanimousLegSl(args.familyTrades);
    const { stoploss: prioritySl, source } = resolveEffectiveStoplossPriority({
        anchorSl,
        mgmtSl,
        channelSl: channelSl && channelSl > 0 ? channelSl : null,
        legConsensus,
        basketTargetSl,
    });
    // The authoritative basket target and an explicit recent channel adjustment
    // are the user's latest instruction and must win for the whole basket and new
    // layers — even when they LOOSEN the stop. Merging with the most-protective
    // open-leg SL here would silently keep a tighter/older leg SL and revert the
    // adjustment. Auto-breakeven re-tightens individual legs separately.
    const protectiveLegSl = mostProtectiveOpenLegSl(args.familyTrades, isBuy);
    const stoploss = (source === 'basket_target' || source === 'mgmt_signal')
        ? prioritySl
        : mergeWithProtectiveLegSl(prioritySl, protectiveLegSl, isBuy);
    const parsedSlice = {
        sl: stoploss > 0 ? stoploss : args.anchorParsed.sl,
        tp: tpLevels.length ? tpLevels : args.anchorParsed.tp,
    };
    return {
        stoploss,
        tpLevels,
        parsedSlice,
        source,
        sourceSignalId,
        anchorSl,
    };
}
function logEffectiveBasketStops(prefix, anchorSignalId, effective) {
    const tag = prefix.endsWith(' ') ? prefix.slice(0, -1) : prefix;
    console.log(`${tag} [effectiveStops] basket=${anchorSignalId} sl=${effective.stoploss}`
        + ` source=${effective.source}${effective.sourceSignalId ? ` signal=${effective.sourceSignalId}` : ''}`
        + ` anchor_sl=${effective.anchorSl}`);
}
