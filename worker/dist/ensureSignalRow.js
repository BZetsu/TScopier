"use strict";
/**
 * Ensure a `signals` row exists for a dispatched signal UUID before any
 * FK-dependent writes (`trades`, `trade_execution_logs`, `range_pending_legs`).
 *
 * Dispatch-first used to fire OrderSend before persist completed; post-fill
 * inserts then failed on `signal_id` FK and left ghost MT positions with no
 * Activities / Copier Logs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSignalRow = ensureSignalRow;
exports.isSignalFkViolation = isSignalFkViolation;
function buildSignalRowPatch(args) {
    return {
        id: args.id,
        user_id: args.user_id,
        channel_id: args.channel_id ?? null,
        raw_message: args.raw_message ?? '',
        raw_image_url: null,
        status: args.status ?? 'parsed',
        parsed_data: args.parsed_data ?? null,
        skip_reason: args.skip_reason ?? null,
        telegram_message_id: args.telegram_message_id ?? null,
        is_modification: args.is_modification === true,
        parent_signal_id: args.parent_signal_id ?? null,
        reply_to_message_id: args.reply_to_message_id ?? null,
        ...(args.pipeline_ts ? { pipeline_ts: args.pipeline_ts } : {}),
    };
}
/**
 * Upsert by primary key so the dispatched UUID is always present for FKs.
 * Falls back to a telegram_message_id-null stub if the unique
 * (user, channel, telegram_message) constraint blocks the full row.
 */
async function ensureSignalRow(supabase, args) {
    if (!args.id || !args.user_id) {
        return { ok: false, written: false, error: 'missing_id_or_user' };
    }
    const row = buildSignalRowPatch(args);
    const { error } = await supabase.from('signals').upsert(row, { onConflict: 'id' });
    if (!error)
        return { ok: true, written: true };
    const msg = error.message ?? String(error);
    // Unique (user_id, channel_id, telegram_message_id) may already be owned by
    // another signal id. Still ensure THIS id exists so OrderSend post-fill FKs work.
    if (args.telegram_message_id) {
        const stub = {
            ...row,
            telegram_message_id: null,
            reply_to_message_id: null,
        };
        const { error: stubErr } = await supabase.from('signals').upsert(stub, { onConflict: 'id' });
        if (!stubErr) {
            console.warn(`[ensureSignalRow] upserted stub without telegram_message_id signal=${args.id}`
                + ` after conflict: ${msg.slice(0, 200)}`);
            return { ok: true, written: true };
        }
        console.error(`[ensureSignalRow] stub upsert failed signal=${args.id}: ${stubErr.message} (primary: ${msg.slice(0, 200)})`);
        return { ok: false, written: false, error: stubErr.message };
    }
    console.error(`[ensureSignalRow] upsert failed signal=${args.id}: ${msg}`);
    return { ok: false, written: false, error: msg };
}
/** True when a PostgREST / Postgres error looks like a missing-signal FK violation. */
function isSignalFkViolation(message) {
    const m = String(message ?? '').toLowerCase();
    if (!m)
        return false;
    return (m.includes('signals')
        && (m.includes('foreign key') || m.includes('violates foreign key') || m.includes('signal_id'))) || m.includes('trades_signal_id_fkey')
        || m.includes('trade_execution_logs_signal_id_fkey')
        || m.includes('range_pending_legs_signal_id_fkey')
        || m.includes('partial_tp_legs_signal_id_fkey');
}
