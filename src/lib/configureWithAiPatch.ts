/** Client allowlist mirroring supabase/functions/_shared/assistantConfigTools CONFIGURE_AI_PATCHABLE_KEYS. */

export const CONFIGURE_AI_PATCHABLE_KEYS = new Set([
  'risk_mode',
  'fixed_lot',
  'dynamic_balance_percent',
  'trade_style',
  'multi_trade_leg_percent',
  'range_trading',
  'range_percent',
  'range_step_pips',
  'range_distance_pips',
  'range_layer_till_close',
  'layering_mode',
  'static_layer_count',
  'dynamic_step_pips',
  'dynamic_max_layers',
  'range_layering_type',
  'use_signal_entry_range',
  'close_worse_entries',
  'close_worse_entries_pips',
  'reverse_signal',
  'use_signal_entry_price',
  'signal_entry_prefer',
  'signal_entry_pip_tolerance',
  'use_predefined_sl_pips',
  'predefined_sl_pips',
  'use_predefined_tp_pips',
  'predefined_tp_pips',
  'symbol_prefix',
  'symbol_suffix',
  'symbol_to_trade',
  'symbols_exclude',
  'close_on_opposite_signal',
  'order_comments_enabled',
  'pending_expiry_hours',
  'add_new_trades_to_existing',
  'trailing_enabled',
  'trailing_start_pips',
  'trailing_step_pips',
  'trailing_distance_pips',
  'tp_lots',
  'single_tp_target',
  'move_sl_to_entry_after_mode',
  'move_sl_to_entry_after_value',
  'move_sl_to_entry_tp_index',
  'move_sl_to_entry_type',
  'breakeven_offset_pips',
  'move_sl_to_entry_after_tp_index',
  'move_sl_to_entry_after_pips',
  'news_trading_enabled',
  'news_avoid_impacts',
  'close_before_news_minutes',
  'resume_after_news_minutes',
  'time_filter_enabled',
  'trade_start_hour',
  'trade_end_hour',
  'days_filter_enabled',
  'trade_days',
])

export function sanitizeConfigureAiPatch(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CONFIGURE_AI_PATCHABLE_KEYS.has(key)) continue
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

export function summarizeConfigureAiPatch(patch: Record<string, unknown>): string {
  const parts: string[] = []
  if (patch.fixed_lot != null) parts.push(`lot ${patch.fixed_lot}`)
  if (patch.risk_mode != null) parts.push(`risk ${String(patch.risk_mode)}`)
  if (patch.dynamic_balance_percent != null) parts.push(`risk% ${patch.dynamic_balance_percent}`)
  if (patch.trade_style != null) parts.push(`style ${String(patch.trade_style)}`)
  if (patch.multi_trade_leg_percent != null) parts.push(`leg% ${patch.multi_trade_leg_percent}`)
  if (patch.range_trading === true) parts.push('range on')
  if (patch.range_trading === false) parts.push('range off')
  if (patch.trailing_enabled === true) parts.push('trailing on')
  if (patch.use_signal_entry_price === true) parts.push('signal entry price on')
  if (patch.signal_entry_prefer === 'last_price') parts.push('entry Last Price')
  else if (patch.signal_entry_prefer === 'first_price') parts.push('entry First Price')
  if (parts.length === 0) {
    const keys = Object.keys(patch)
    return keys.length ? keys.slice(0, 6).join(', ') : 'settings'
  }
  return parts.join(', ')
}
