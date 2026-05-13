/**
 * Helpers for persisting `range_pending_legs` under partial unique indexes /
 * PostgREST upsert quirks. Used by TradeExecutor batch upsert → per-row insert.
 */

export function isPostgresDuplicateKeyError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const o = e as { code?: string; message?: string }
  const code = o.code
  const m = o.message ?? ''
  return code === '23505' || /duplicate key|unique constraint/i.test(m)
}
