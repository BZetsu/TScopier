import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ENTRY_MISSING_PREDEFINED_STOPS_REASON,
  evaluateParsedSignalExecutionEligibility,
  manualHasSlAndTpOverride,
} from './signalExecutionEligibility'
import { messageHasImperativeEntryPhrase } from './signalImperativeEntry'
import {
  buildRangeEntryWait,
  narrowRangeWaitToNearestZoneLevel,
} from './manualPlanning/signalEntryRange'
import {
  DEFAULT_CHANNEL_KEYWORDS,
  parseBuySellZonesBulletin,
  parseChannelMessageSync,
} from './parseSignal'
import {
  collapseZonesLevelsToWaitBand,
  extractBuySellZonesBulletin,
  looksLikeBuySellZonesBulletin,
} from './signalPriceInference'
import { tradeIntentToChannelParsedSignal } from './signalIntent/tradeIntentAdapter'
import type { TradeIntent } from './signalIntent/tradeIntent'

const predefinedManual = {
  use_predefined_sl_pips: true,
  predefined_sl_pips: 30,
  use_predefined_tp_pips: true,
  predefined_tp_pips: [20, 40, 60],
}

test('extractBuySellZonesBulletin: GOLD SELL ZONES two levels', () => {
  const b = extractBuySellZonesBulletin('GOLD SELL ZONES \n\n3866\n3874')
  assert.ok(b)
  assert.equal(b!.side, 'sell')
  assert.equal(b!.symbol, 'XAUUSD')
  assert.deepEqual(b!.levels, [3866, 3874])
  assert.equal(b!.entry_zone_low, 3866)
  assert.equal(b!.entry_zone_high, 3874)
})

test('extractBuySellZonesBulletin: GOLD BUY ZONES three levels', () => {
  const b = extractBuySellZonesBulletin('GOLD BUY ZONES\n\n3847\n3842\n3837')
  assert.ok(b)
  assert.equal(b!.side, 'buy')
  assert.deepEqual(b!.levels, [3847, 3842, 3837])
  assert.equal(b!.entry_zone_low, 3837)
  assert.equal(b!.entry_zone_high, 3847)
})

test('extractBuySellZonesBulletin: BTC BUY ZONES', () => {
  const b = extractBuySellZonesBulletin('BTC BUY ZONES\n\n63979\n62758')
  assert.ok(b)
  assert.equal(b!.symbol, 'BTCUSD')
  assert.equal(b!.side, 'buy')
  assert.deepEqual(b!.levels, [63979, 62758])
})

test('parseBuySellZonesBulletin: no invented SL/TP', () => {
  const parsed = parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3866\n3874')
  assert.ok(parsed)
  assert.equal(parsed!.action, 'sell')
  assert.equal(parsed!.symbol, 'XAUUSD')
  assert.equal(parsed!.sl, null)
  assert.deepEqual(parsed!.tp, [])
  assert.deepEqual(parsed!.entry_zone_levels, [3866, 3874])
  assert.equal(parsed!.entry_zone_low, 3866)
  assert.equal(parsed!.entry_zone_high, 3874)
})

test('parseChannelMessageSync: ZONES bulletin stays without SL/TP after enrich', () => {
  const result = parseChannelMessageSync(
    'GOLD SELL ZONES\n\n3866\n3874',
    DEFAULT_CHANNEL_KEYWORDS,
    null,
  )
  assert.equal(result.status, 'parsed')
  assert.equal(result.parsed.action, 'sell')
  assert.equal(result.parsed.sl, null)
  assert.deepEqual(result.parsed.tp, [])
  assert.ok((result.parsed.entry_zone_levels?.length ?? 0) >= 2)
})

test('tradeIntentAdapter clears SL/TP for ZONES bulletin even if intent invented them', () => {
  const intent: TradeIntent = {
    kind: 'entry',
    side: 'SELL',
    symbol: 'XAUUSD',
    entry: [3866, 3874],
    sl: 3874,
    tp: [3866],
    sl_unit: 'price',
    tp_unit: 'price',
    confidence: 0.9,
    flags: { open_tp: false, re_enter: false, market_now: false },
    detected_language: 'en',
  }
  const parsed = tradeIntentToChannelParsedSignal(intent, 'GOLD SELL ZONES\n\n3866\n3874')
  assert.equal(parsed.sl, null)
  assert.deepEqual(parsed.tp, [])
  assert.deepEqual(parsed.entry_zone_levels, [3866, 3874])
})

test('messageHasImperativeEntryPhrase: ZONES header counts', () => {
  assert.equal(messageHasImperativeEntryPhrase('GOLD SELL ZONES\n3866\n3874'), true)
  assert.equal(messageHasImperativeEntryPhrase('BTC BUY ZONES\n66790'), true)
})

test('eligibility: ZONES + predefined manuals allowed', () => {
  assert.equal(manualHasSlAndTpOverride(predefinedManual), true)
  const parsed = parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3866\n3874')!
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    'GOLD SELL ZONES\n\n3866\n3874',
    null,
    [predefinedManual],
  )
  assert.equal(el.eligible, true)
})

test('eligibility: ZONES without predefined when manuals known is rejected', () => {
  const parsed = parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3866\n3874')!
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    'GOLD SELL ZONES\n\n3866\n3874',
    null,
    [{ use_predefined_sl_pips: false, use_predefined_tp_pips: false }],
  )
  assert.equal(el.eligible, false)
  assert.equal(el.skipReason, ENTRY_MISSING_PREDEFINED_STOPS_REASON)
})

test('eligibility: ZONES with its own SL and TPs passes without overrides', () => {
  const raw = 'Gold Sell Zone 3712 - 3718\n\nSL : 3723\n\nTP1 : 3707\nTP2 : 3702\nTP3 : 3697'
  const parsed = {
    ...parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3712\n3718')!,
    sl: 3723,
    tp: [3707, 3702, 3697],
  }
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    raw,
    null,
    [{ use_predefined_sl_pips: false, use_predefined_tp_pips: false }],
  )
  assert.equal(el.eligible, true)
})

test('eligibility: ZONES with TPs but no SL still needs overrides', () => {
  const raw = 'Gold Sell Zone 3712 - 3718\n\nTP1 : 3707\nTP2 : 3702'
  const parsed = {
    ...parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3712\n3718')!,
    sl: null,
    tp: [3707, 3702],
  }
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    raw,
    null,
    [{ use_predefined_sl_pips: false, use_predefined_tp_pips: false }],
  )
  assert.equal(el.eligible, false)
  assert.equal(el.skipReason, ENTRY_MISSING_PREDEFINED_STOPS_REASON)
})

test('eligibility: ZONES with a stop on the wrong side still needs overrides', () => {
  const raw = 'Gold Sell Zone 3712 - 3718\n\nSL : 3705\n\nTP1 : 3707\nTP2 : 3702'
  const parsed = {
    ...parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3712\n3718')!,
    sl: 3705,
    tp: [3707, 3702],
  }
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    raw,
    null,
    [{ use_predefined_sl_pips: false, use_predefined_tp_pips: false }],
  )
  assert.equal(el.eligible, false)
  assert.equal(el.skipReason, ENTRY_MISSING_PREDEFINED_STOPS_REASON)
})

test('eligibility: ZONES whose parsed stop disagrees with the labelled stop is rejected', () => {
  const raw = 'Gold Sell Zone 3712 - 3718\n\nSL : 3723\n\nTP1 : 3707\nTP2 : 3702'
  const parsed = {
    ...parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3712\n3718')!,
    sl: 3730,
    tp: [3707, 3702],
  }
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    raw,
    null,
    [{ use_predefined_sl_pips: false, use_predefined_tp_pips: false }],
  )
  assert.equal(el.eligible, false)
  assert.equal(el.skipReason, ENTRY_MISSING_PREDEFINED_STOPS_REASON)
})

test('parseChannelMessageSync: labelled zone keeps its own SL and TPs', () => {
  const result = parseChannelMessageSync(
    'Gold Sell Zone 3712 - 3718\n\nSL : 3723\n\nTP1 : 3707\nTP2 : 3702\nTP3 : 3697',
    DEFAULT_CHANNEL_KEYWORDS,
    null,
  )
  assert.equal(result.status, 'parsed')
  assert.equal(result.parsed.action, 'sell')
  assert.equal(result.parsed.sl, 3723)
  assert.ok((result.parsed.tp?.length ?? 0) >= 3)
  assert.equal(result.parsed.entry_zone_low, 3712)
  assert.equal(result.parsed.entry_zone_high, 3718)
})

test('eligibility: ZONES without manuals list still allowed (listener path)', () => {
  const parsed = parseBuySellZonesBulletin('GOLD SELL ZONES\n\n3866\n3874')!
  const el = evaluateParsedSignalExecutionEligibility(
    parsed,
    'GOLD SELL ZONES\n\n3866\n3874',
  )
  assert.equal(el.eligible, true)
})

test('collapseZonesLevelsToWaitBand: two nearby levels keep min-max', () => {
  const band = collapseZonesLevelsToWaitBand({
    levels: [3866, 3874],
    side: 'sell',
    bid: 3854,
    ask: 3855,
    tolerancePips: 10,
    pipSize: 0.1,
  })
  assert.ok(band)
  assert.equal(band!.collapsed, false)
  assert.equal(band!.zoneLo, 3866)
  assert.equal(band!.zoneHi, 3874)
})

test('collapseZonesLevelsToWaitBand: three levels collapse to nearest sell above bid', () => {
  const band = collapseZonesLevelsToWaitBand({
    levels: [3847, 3842, 3837],
    side: 'buy',
    bid: 3850,
    ask: 3851,
    tolerancePips: 10,
    pipSize: 0.1,
  })
  assert.ok(band)
  assert.equal(band!.collapsed, true)
  // All buy levels below ask → pick highest (3847)
  assert.equal(band!.level, 3847)
  assert.ok(band!.zoneLo < 3847 && band!.zoneHi > 3847)
})

test('narrowRangeWaitToNearestZoneLevel + buildRangeEntryWait', () => {
  const parsed = {
    action: 'buy',
    symbol: 'XAUUSD',
    entry_price: null,
    entry_zone_low: 3726,
    entry_zone_high: 3801,
    entry_zone_levels: [3801, 3775, 3745, 3726],
    sl: null,
    tp: [],
    lot_size: null,
  }
  const wait = buildRangeEntryWait({
    manual: {
      use_signal_entry_range: true,
      trade_style: 'multi',
      signal_entry_pip_tolerance: 10,
    },
    parsed,
    isBuy: true,
  })!
  const narrowed = narrowRangeWaitToNearestZoneLevel({
    wait,
    parsed,
    bid: 3850,
    ask: 3851,
    pipSize: 0.1,
  })
  assert.equal(narrowed.collapsed, true)
  assert.equal(narrowed.wait.entryPrice, 3801)
  assert.ok(looksLikeBuySellZonesBulletin('GOLD BUY ZONES\n3801'))
})
