"use strict";
/**
 * Helpers for persisting `range_pending_legs` under partial unique indexes /
 * PostgREST upsert quirks. Used by TradeExecutor batch upsert → per-row insert.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPostgresDuplicateKeyError = isPostgresDuplicateKeyError;
function isPostgresDuplicateKeyError(e) {
    if (!e || typeof e !== 'object')
        return false;
    const o = e;
    const code = o.code;
    const m = o.message ?? '';
    return code === '23505' || /duplicate key|unique constraint/i.test(m);
}
