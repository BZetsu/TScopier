"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDesiredBasket = loadDesiredBasket;
exports.setDesiredBasket = setDesiredBasket;
exports.resolveLegTargets = resolveLegTargets;
function positive(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizeTps(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map(t => (typeof t === 'number' ? t : Number(t))).filter((t) => Number.isFinite(t) && t > 0);
}
/** Read the desired state for a basket, or null if none recorded yet. */
async function loadDesiredBasket(supabase, brokerAccountId, anchorSignalId) {
    const { data, error } = await supabase
        .from('basket_sl_tp_targets')
        .select('symbol,stoploss,tp_levels,source,instruction_at,updated_at')
        .eq('broker_account_id', brokerAccountId)
        .eq('anchor_signal_id', anchorSignalId)
        .maybeSingle();
    if (error || !data)
        return null;
    const row = data;
    return {
        brokerAccountId,
        anchorSignalId,
        symbol: row.symbol ?? '',
        stoploss: positive(row.stoploss),
        tpLevels: normalizeTps(row.tp_levels),
        source: row.source ?? 'entry',
        instructionAt: row.instruction_at ?? row.updated_at ?? null,
    };
}
/**
 * Record a desired-state instruction. Atomic latest-instruction-wins + side-merge
 * (an SL-only instruction keeps the TP ladder and vice versa). A side that is not
 * supplied (or non-positive) is left untouched.
 */
async function setDesiredBasket(supabase, args) {
    const sl = positive(args.stoploss);
    const tps = args.tpLevels != null ? normalizeTps(args.tpLevels) : null;
    if (sl == null && (tps == null || tps.length === 0))
        return;
    const { error } = await supabase.rpc('upsert_basket_sl_tp_target', {
        p_user_id: args.userId,
        p_broker_account_id: args.brokerAccountId,
        p_anchor_signal_id: args.anchorSignalId,
        p_channel_id: args.channelId,
        p_symbol: args.symbol,
        p_stoploss: sl,
        p_tp_levels: tps,
        p_source: args.source,
        p_instruction_at: args.instructionAt ?? new Date().toISOString(),
    });
    if (error) {
        console.warn(`[basketStore] setDesired failed broker=${args.brokerAccountId} anchor=${args.anchorSignalId}: ${error.message}`);
    }
}
/**
 * Resolve the SL/TP that should be applied to a leg right now. The desired-state
 * row is authoritative; auto-breakeven (stamped on the trade leg, newer than the
 * desired instruction) is honored so a stale adjust can't revert a fresh BE.
 */
function resolveLegTargets(args) {
    const d = args.desired;
    const autoBeNewer = args.autoBeAt != null && d?.instructionAt != null
        && Date.parse(args.autoBeAt) > Date.parse(d.instructionAt);
    if (autoBeNewer && args.autoBeSl != null && args.autoBeSl > 0) {
        return { stoploss: args.autoBeSl, tpLevels: d?.tpLevels?.length ? d.tpLevels : (args.anchorTps ?? []), source: 'auto_breakeven' };
    }
    if (d && (d.stoploss != null || d.tpLevels.length)) {
        return {
            stoploss: d.stoploss ?? positive(args.anchorSl),
            tpLevels: d.tpLevels.length ? d.tpLevels : (args.anchorTps ?? []),
            source: d.source,
        };
    }
    return { stoploss: positive(args.anchorSl), tpLevels: args.anchorTps ?? [], source: 'anchor' };
}
