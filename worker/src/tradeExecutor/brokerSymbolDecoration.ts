import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrokerRow } from './types'

export function hasLegacySymbolDecoration(manual: Record<string, unknown>): boolean {
  const prefix = String(manual.symbol_prefix ?? '').trim()
  const suffix = String(manual.symbol_suffix ?? '').trim()
  const mapping = manual.symbol_mapping
  const hasMap = mapping != null
    && typeof mapping === 'object'
    && Object.keys(mapping as Record<string, unknown>).length > 0
  return prefix.length > 0 || suffix.length > 0 || hasMap
}

export function stripSymbolDecoration(manual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...manual,
    symbol_prefix: '',
    symbol_suffix: '',
    symbol_mapping: {},
  }
}

/** Remove stored prefix/suffix/map so runtime fuzzy broker matching is used. */
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
    `[tradeExecutor] cleared legacy symbol decoration broker=${broker.id} (auto-match enabled)`,
  )
  return true
}
