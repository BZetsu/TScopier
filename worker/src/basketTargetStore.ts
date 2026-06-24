/**
 * Per-basket "evolving signal" SL/TP store — the single authoritative record of
 * the latest intended SL/TP for an open basket (broker + anchor signal).
 *
 * Written once per management instruction (entry seed, adjust, breakeven,
 * auto-breakeven) and read FIRST by resolveEffectiveBasketStops. Because every
 * write stamps the latest values, "the latest instruction wins" is a single,
 * timestamp-free rule — no scanning the signals table and no recency heuristics.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type BasketTargetSource = 'entry' | 'adjust' | 'breakeven' | 'auto_breakeven'

export type BasketSlTpTarget = {
  stoploss: number | null
  tpLevels: number[]
  source: string
  updatedAt: string | null
}

function positiveLevel(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTpLevels(tp: unknown): number[] {
  if (!Array.isArray(tp)) return []
  return tp
    .map(t => (typeof t === 'number' ? t : Number(t)))
    .filter((t): t is number => Number.isFinite(t) && t > 0)
}

export async function loadBasketSlTpTarget(
  supabase: SupabaseClient,
  brokerAccountId: string,
  anchorSignalId: string,
): Promise<BasketSlTpTarget | null> {
  const { data, error } = await supabase
    .from('basket_sl_tp_targets')
    .select('stoploss,tp_levels,source,updated_at')
    .eq('broker_account_id', brokerAccountId)
    .eq('anchor_signal_id', anchorSignalId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { stoploss: number | null; tp_levels: unknown; source: string | null; updated_at: string | null }
  return {
    stoploss: positiveLevel(row.stoploss),
    tpLevels: normalizeTpLevels(row.tp_levels),
    source: row.source ?? 'entry',
    updatedAt: row.updated_at ?? null,
  }
}

/**
 * Record the latest SL/TP intent for a basket. Merges with the existing row:
 * a side that is not supplied (or supplied as null/empty) keeps its prior value,
 * so a breakeven (SL only) does not wipe the TP ladder and vice versa.
 */
export async function upsertBasketSlTpTarget(
  supabase: SupabaseClient,
  args: {
    userId: string
    brokerAccountId: string
    anchorSignalId: string
    channelId: string | null
    symbol: string
    stoploss?: number | null
    tpLevels?: number[] | null
    source: BasketTargetSource
  },
): Promise<void> {
  const sl = positiveLevel(args.stoploss)
  const tps = args.tpLevels != null ? normalizeTpLevels(args.tpLevels) : null
  if (sl == null && (tps == null || tps.length === 0)) return

  const existing = await loadBasketSlTpTarget(supabase, args.brokerAccountId, args.anchorSignalId)
  const row = {
    user_id: args.userId,
    broker_account_id: args.brokerAccountId,
    anchor_signal_id: args.anchorSignalId,
    channel_id: args.channelId,
    symbol: args.symbol,
    stoploss: sl ?? existing?.stoploss ?? null,
    tp_levels: tps != null && tps.length > 0 ? tps : (existing?.tpLevels ?? []),
    source: args.source,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('basket_sl_tp_targets')
    .upsert(row, { onConflict: 'broker_account_id,anchor_signal_id' })
  if (error) {
    console.warn(
      `[basketTargetStore] upsert failed broker=${args.brokerAccountId} anchor=${args.anchorSignalId}: ${error.message}`,
    )
  }
}
