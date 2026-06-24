"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBasketSlTpTarget = loadBasketSlTpTarget;
exports.findStaleBasketKeys = findStaleBasketKeys;
exports.upsertBasketSlTpTarget = upsertBasketSlTpTarget;
function positiveLevel(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizeTpLevels(tp) {
    if (!Array.isArray(tp))
        return [];
    return tp
        .map(t => (typeof t === 'number' ? t : Number(t)))
        .filter((t) => Number.isFinite(t) && t > 0);
}
async function loadBasketSlTpTarget(supabase, brokerAccountId, anchorSignalId) {
    const { data, error } = await supabase
        .from('basket_sl_tp_targets')
        .select('stoploss,tp_levels,source,updated_at,instruction_at')
        .eq('broker_account_id', brokerAccountId)
        .eq('anchor_signal_id', anchorSignalId)
        .maybeSingle();
    if (error || !data)
        return null;
    const row = data;
    return {
        stoploss: positiveLevel(row.stoploss),
        tpLevels: normalizeTpLevels(row.tp_levels),
        source: row.source ?? 'entry',
        updatedAt: row.updated_at ?? null,
        instructionAt: row.instruction_at ?? row.updated_at ?? null,
    };
}
/**
 * Returns the subset of basket keys (`${brokerAccountId}|${anchorSignalId}`)
 * whose recorded target is from a strictly NEWER instruction than `instructionAt`.
 * Applying an instruction with this timestamp to those baskets would be stale
 * (the live broker write would conflict with the latest recorded instruction).
 */
async function findStaleBasketKeys(supabase, basketKeys, instructionAt) {
    const stale = new Set();
    if (!instructionAt)
        return stale;
    const at = Date.parse(instructionAt);
    if (!Number.isFinite(at))
        return stale;
    for (const key of basketKeys) {
        const [brokerId, anchorSignalId] = key.split('|');
        if (!brokerId || !anchorSignalId)
            continue;
        const target = await loadBasketSlTpTarget(supabase, brokerId, anchorSignalId);
        if (target?.instructionAt && Date.parse(target.instructionAt) > at)
            stale.add(key);
    }
    return stale;
}
/**
 * Record the latest SL/TP intent for a basket — "latest INSTRUCTION wins".
 *
 * Ordering is by `instructionAt` (the source signal's created_at / auto-BE time),
 * NOT wall-clock write time, because signals are processed out of order (retries,
 * reconcile jobs, multi-shard). The DB function applies the write atomically and
 * refuses to overwrite a newer instruction with an older one, and merges so a
 * side that is not supplied keeps its prior value (breakeven keeps the TP ladder).
 */
async function upsertBasketSlTpTarget(supabase, args) {
    const sl = positiveLevel(args.stoploss);
    const tps = args.tpLevels != null ? normalizeTpLevels(args.tpLevels) : null;
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
        console.warn(`[basketTargetStore] upsert failed broker=${args.brokerAccountId} anchor=${args.anchorSignalId}: ${error.message}`);
    }
}
