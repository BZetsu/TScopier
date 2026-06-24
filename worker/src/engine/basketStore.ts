/**
 * Basket desired-state store (Phase 2a) - the single source of truth for what a
 * basket's stops SHOULD be. Everything (entry seed, adjust, breakeven, auto-BE)
 * writes here; the reconciler and ladder READ here. No competing re-derivation.
 *
 * Backed by the production `basket_sl_tp_targets` table + the atomic, instruction-
 * ordered RPC `upsert_basket_sl_tp_target` (latest INSTRUCTION wins, not latest
 * write), so out-of-order processing can never revert a newer instruction.
 *
 * A "basket" is identified by (broker_account_id, anchor_signal_id).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type DesiredSource = 'entry' | 'adjust' | 'breakeven' | 'auto_breakeven'

export type DesiredBasket = {
  brokerAccountId: string
  anchorSignalId: string
  symbol: string
  /** Desired stop loss for every open leg (0/undefined = no SL desired yet). */
  stoploss: number | null
  /** Desired TP ladder, deepest-last. */
  tpLevels: number[]
  source: string
  /** The source instruction's own timestamp (signal created_at / auto-BE time). */
  instructionAt: string | null
}

function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTps(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map(t => (typeof t === 'number' ? t : Number(t))).filter((t): t is number => Number.isFinite(t) && t > 0)
}

/** Read the desired state for a basket, or null if none recorded yet. */
export async function loadDesiredBasket(
  supabase: SupabaseClient,
  brokerAccountId: string,
  anchorSignalId: string,
): Promise<DesiredBasket | null> {
  const { data, error } = await supabase
    .from('basket_sl_tp_targets')
    .select('symbol,stoploss,tp_levels,source,instruction_at,updated_at')
    .eq('broker_account_id', brokerAccountId)
    .eq('anchor_signal_id', anchorSignalId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as {
    symbol: string | null; stoploss: number | null; tp_levels: unknown
    source: string | null; instruction_at: string | null; updated_at: string | null
  }
  return {
    brokerAccountId,
    anchorSignalId,
    symbol: row.symbol ?? '',
    stoploss: positive(row.stoploss),
    tpLevels: normalizeTps(row.tp_levels),
    source: row.source ?? 'entry',
    instructionAt: row.instruction_at ?? row.updated_at ?? null,
  }
}

/**
 * Record a desired-state instruction. Atomic latest-instruction-wins + side-merge
 * (an SL-only instruction keeps the TP ladder and vice versa). A side that is not
 * supplied (or non-positive) is left untouched.
 */
export async function setDesiredBasket(
  supabase: SupabaseClient,
  args: {
    userId: string
    brokerAccountId: string
    anchorSignalId: string
    channelId: string | null
    symbol: string
    stoploss?: number | null
    tpLevels?: number[] | null
    source: DesiredSource
    /** Defaults to now(). Pass the source signal's created_at for correct ordering. */
    instructionAt?: string | null
  },
): Promise<void> {
  const sl = positive(args.stoploss)
  const tps = args.tpLevels != null ? normalizeTps(args.tpLevels) : null
  if (sl == null && (tps == null || tps.length === 0)) return
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
  })
  if (error) {
    console.warn(`[basketStore] setDesired failed broker=${args.brokerAccountId} anchor=${args.anchorSignalId}: ${error.message}`)
  }
}

/**
 * Resolve the SL/TP that should be applied to a leg right now. The desired-state
 * row is authoritative; auto-breakeven (stamped on the trade leg, newer than the
 * desired instruction) is honored so a stale adjust can't revert a fresh BE.
 */
export function resolveLegTargets(args: {
  desired: DesiredBasket | null
  /** Most recent auto-breakeven timestamp across the basket's legs, if any. */
  autoBeAt?: string | null
  /** Per-leg breakeven SL to honor when auto-BE is newer than the desired instruction. */
  autoBeSl?: number | null
  /** Fallback SL/TP from the anchor signal if no desired row exists yet. */
  anchorSl?: number | null
  anchorTps?: number[]
  isBuy: boolean
}): { stoploss: number | null; tpLevels: number[]; source: string } {
  const d = args.desired
  const autoBeNewer = args.autoBeAt != null && d?.instructionAt != null
    && Date.parse(args.autoBeAt) > Date.parse(d.instructionAt)

  if (autoBeNewer && args.autoBeSl != null && args.autoBeSl > 0) {
    return { stoploss: args.autoBeSl, tpLevels: d?.tpLevels?.length ? d.tpLevels : (args.anchorTps ?? []), source: 'auto_breakeven' }
  }
  if (d && (d.stoploss != null || d.tpLevels.length)) {
    return {
      stoploss: d.stoploss ?? positive(args.anchorSl),
      tpLevels: d.tpLevels.length ? d.tpLevels : (args.anchorTps ?? []),
      source: d.source,
    }
  }
  return { stoploss: positive(args.anchorSl), tpLevels: args.anchorTps ?? [], source: 'anchor' }
}
