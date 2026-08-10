import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrokerRow } from './types'

export function hasLegacySymbolDecoration(manual: Record<string, unknown>): boolean {
  const prefix = String(manual.symbol_prefix ?? '').trim()
  const suffix = String(manual.symbol_suffix ?? '').trim()
  // Explicit symbol_mapping is an intentional escape hatch (e.g. XAUUSD → GOLD#) when
  // fuzzy auto-match cannot rename instruments. Never treat maps as disposable "legacy".
  return prefix.length > 0 || suffix.length > 0
}

export function stripSymbolDecoration(manual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...manual,
    symbol_prefix: '',
    symbol_suffix: '',
  }
}

/** Remove stored prefix/suffix so runtime fuzzy broker matching is used. Keeps symbol_mapping. */
export async function clearLegacySymbolDecorationIfPresent(
  supabase: SupabaseClient,
  broker: BrokerRow,
): Promise<boolean> {
  const manual = (broker.manual_settings ?? {}) as Record<string, unknown>
  if (!hasLegacySymbolDecoration(manual)) return false

  const nextSettings = stripSymbolDecoration(manual)
  const { error } = await supabase
    .from('broker_accounts')
    .update({ manual_settings: nextSettings })
    .eq('id', broker.id)
  if (error) {
    console.warn(
      `[tradeExecutor] clear legacy symbol decoration failed broker=${broker.id}: ${error.message}`,
    )
    return false
  }

  broker.manual_settings = nextSettings as BrokerRow['manual_settings']
  console.log(
    `[tradeExecutor] cleared legacy symbol prefix/suffix broker=${broker.id} (auto-match enabled; symbol_mapping preserved)`,
  )
  return true
}
