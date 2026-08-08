/**
 * Shared helpers for assistant-chat config / broker resolution tools.
 * Kept Deno-friendly (no Node imports).
 */

export const DEFAULT_MANUAL_SETTINGS: Record<string, unknown> = {
  schema_version: 1,
  symbol_mapping: {},
  symbol_prefix: "",
  symbol_suffix: "",
  symbol_to_trade: null,
  symbols_exclude: [],
  risk_mode: "fixed_lot",
  fixed_lot: 0.01,
  dynamic_balance_percent: 1,
  multi_trade_leg_percent: 5,
  trade_style: "single",
  range_trading: false,
  range_percent: 50,
  range_step_pips: 0,
  range_distance_pips: 30,
  range_layer_till_close: false,
  layering_mode: "legacy",
  range_layering_type: "auto",
  reverse_signal: false,
  use_signal_entry_price: false,
  signal_entry_pip_tolerance: 10,
  close_on_opposite_signal: false,
  order_comments_enabled: true,
};

/** Keys the model may patch via update_channel_config. */
export const PATCHABLE_MANUAL_KEYS = new Set([
  "risk_mode",
  "fixed_lot",
  "dynamic_balance_percent",
  "trade_style",
  "multi_trade_leg_percent",
  "range_trading",
  "range_percent",
  "range_step_pips",
  "range_distance_pips",
  "range_layer_till_close",
  "layering_mode",
  "static_layer_count",
  "dynamic_step_pips",
  "dynamic_max_layers",
  "range_layering_type",
  "use_signal_entry_range",
  "close_worse_entries",
  "close_worse_entries_pips",
  "reverse_signal",
  "use_signal_entry_price",
  "signal_entry_pip_tolerance",
  "use_predefined_sl_pips",
  "predefined_sl_pips",
  "use_predefined_tp_pips",
  "predefined_tp_pips",
  "symbol_prefix",
  "symbol_suffix",
  "symbol_to_trade",
  "symbols_exclude",
  "close_on_opposite_signal",
  "order_comments_enabled",
  "pending_expiry_hours",
  "add_new_trades_to_existing",
  "trailing_enabled",
  "trailing_start_pips",
  "trailing_step_pips",
  "trailing_distance_pips",
]);

export function sanitizeManualPatch(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PATCHABLE_MANUAL_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function mergeManualSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = {
    ...DEFAULT_MANUAL_SETTINGS,
    ...current,
    ...patch,
    schema_version: 1,
  };
  if (merged.news_trading_enabled === true) {
    merged.allow_high_impact_news = true;
  }
  return merged;
}

export function summarizeManualPatch(patch: Record<string, unknown>): string {
  const parts: string[] = [];
  if (patch.fixed_lot != null) parts.push(`lot ${patch.fixed_lot}`);
  if (patch.risk_mode != null) parts.push(`risk ${String(patch.risk_mode)}`);
  if (patch.dynamic_balance_percent != null) {
    parts.push(`risk% ${patch.dynamic_balance_percent}`);
  }
  if (patch.trade_style != null) parts.push(`style ${String(patch.trade_style)}`);
  if (patch.multi_trade_leg_percent != null) {
    parts.push(`leg% ${patch.multi_trade_leg_percent}`);
  }
  if (patch.range_trading === true) parts.push("range on");
  if (patch.range_trading === false) parts.push("range off");
  if (patch.range_percent != null) parts.push(`range% ${patch.range_percent}`);
  if (patch.range_step_pips != null) parts.push(`step ${patch.range_step_pips}p`);
  if (patch.range_distance_pips != null) parts.push(`distance ${patch.range_distance_pips}p`);
  if (patch.reverse_signal === true) parts.push("reverse on");
  if (parts.length === 0) {
    const keys = Object.keys(patch);
    return keys.length ? keys.slice(0, 6).join(", ") : "settings";
  }
  return parts.join(", ");
}

export function normalizeChannelUsername(raw: string): string {
  return String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
}
