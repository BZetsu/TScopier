/**
 * Throwaway trace (plain English output) — what the program asks, in order,
 * for message 1115 with this user's real settings.
 */
import { isChannelSlTpUpdateBlocked, normalizeChannelMessageFiltersMap } from './src/channelMessageFilters'
import { parsedSignalHasExplicitStops } from './src/channelActiveTradeParams'

const channelId = '5db5298e-d814-42a9-9686-1277240d62fd'

const parsed: any = {
  sl: 3776.93, tp: [3749.22], action: 'sell', symbol: 'XAUUSD', open_tp: false,
  sl_unit: 'price', tp_unit: 'price', lot_size: null, confidence: 0.99,
  entry_price: null, entry_zone_low: null, entry_zone_high: null,
  raw_instruction: 'Xauusd sell now\nSl 3776.93\nTp 3749.22 \n@topsignalleak @tslforexshop topsignalleaks.netlify.app',
  entry_order_type: null,
}

const IGNORE = normalizeChannelMessageFiltersMap({
  [channelId]: { modify_sl: 'ignore', modify_tp: 'ignore' },
})
const ALLOW = normalizeChannelMessageFiltersMap({
  [channelId]: { modify_sl: 'allow', modify_tp: 'allow' },
})

for (const [label, filters] of Object.entries({ 'his settings (IGNORE SL/TP)': IGNORE, 'if set to ALLOW': ALLOW })) {
  console.log(`\n--- ${label} ---`)
  console.log('Q1. Does the message have a stop loss / take profit? ....', parsedSignalHasExplicitStops(parsed) ? 'YES' : 'NO')
  const blocked = isChannelSlTpUpdateBlocked(filters, channelId, parsed)
  console.log('Q2. Does the user ignore stop-loss / take-profit edits? ..', blocked ? 'YES' : 'NO')
  console.log('Q3. Does the user have an open trade? ....................', '*** NEVER ASKED ***')
  console.log('=> outcome ..............................................', blocked ? 'MESSAGE DISCARDED (no order, no reason)' : 'ask Q3 next, then open the entry')
}
console.log('')
