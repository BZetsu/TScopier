import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  convertPipOffsetsToPrices,
  looksLikePipOffsetMagnitudes,
  resolveSlUnit,
  resolveTpUnit,
  slClauseHasExplicitPips,
  tpClauseHasExplicitPips,
} from './signalStopUnits'
import {
  DEFAULT_CHANNEL_KEYWORDS,
  normalizeChannelKeywords,
  parseChannelMessageSync,
} from './parseSignal'
import { deriveManualStopsWithClamp } from './manualPlanning/manualStops'
import { signalPipPrice } from './signalPip'

describe('signalStopUnits detection', () => {
  it('detects explicit pip TP clauses', () => {
    assert.equal(tpClauseHasExplicitPips('TP:30/50/100pips'), true)
    assert.equal(tpClauseHasExplicitPips('TP: 30 / 50 / 100 pips'), true)
    assert.equal(tpClauseHasExplicitPips('TP1: 30pips'), true)
    assert.equal(tpClauseHasExplicitPips('take profit 50 pip'), true)
    assert.equal(tpClauseHasExplicitPips('TP: 4090 / 4080'), false)
  })

  it('detects explicit pip SL clauses', () => {
    assert.equal(slClauseHasExplicitPips('SL: 20 pips'), true)
    assert.equal(slClauseHasExplicitPips('SL:4120'), false)
  })

  it('magnitude heuristic treats small ladders as pips vs gold entry', () => {
    assert.equal(looksLikePipOffsetMagnitudes([30, 50, 100], 4109), true)
    assert.equal(looksLikePipOffsetMagnitudes([4090, 4080], 4109), false)
  })

  it('resolveTpUnit prefers explicit then channel flag then magnitude', () => {
    assert.equal(
      resolveTpUnit({ message: 'TP:30/50/100pips', tps: [30, 50, 100], ref: 4109 }),
      'pips',
    )
    assert.equal(
      resolveTpUnit({
        message: 'TP: 30 / 50 / 100',
        tps: [30, 50, 100],
        channelTpInPips: true,
        ref: 4109,
      }),
      'pips',
    )
    assert.equal(
      resolveTpUnit({ message: 'TP: 4090 / 4080', tps: [4090, 4080], ref: 4109 }),
      'price',
    )
  })

  it('converts sell pip offsets on XAU', () => {
    const pip = signalPipPrice('XAUUSD')
    assert.equal(pip, 0.01)
    const prices = convertPipOffsetsToPrices({
      offsets: [30, 50, 100],
      entryAnchor: 4109,
      isBuy: false,
      pipSize: pip,
    })
    assert.deepEqual(
      prices.map(p => Number(p.toFixed(2))),
      [4108.7, 4108.5, 4108],
    )
  })
})

describe('parseChannelMessageSync pip vs price TPs', () => {
  const sample = `📊XAUUSD - SELL GOLD NOW

❗️ZN :4105-4113

⬆️TP:30/50/100pips

⬇️SL:4120

📍Clear setup – tight risk control
Precise entry. Act fast`

  it('parses sample with ZN zone, pip TPs, and absolute SL', () => {
    const result = parseChannelMessageSync(sample, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'sell')
    assert.equal(result.parsed.symbol, 'XAUUSD')
    assert.equal(result.parsed.entry_zone_low, 4105)
    assert.equal(result.parsed.entry_zone_high, 4113)
    assert.equal(result.parsed.sl, 4120)
    assert.deepEqual(result.parsed.tp, [30, 50, 100])
    assert.equal(result.parsed.tp_unit, 'pips')
    assert.equal(result.parsed.sl_unit, 'price')
  })

  it('keeps absolute price TPs as price unit', () => {
    const msg = `XAUUSD SELL NOW
ENTRY 4109
TP: 4090 / 4080
SL: 4120`
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(result.status, 'parsed')
    assert.deepEqual(result.parsed.tp, [4090, 4080])
    assert.equal(result.parsed.tp_unit ?? 'price', 'price')
  })

  it('honors channel tp_in_pips without the word pips', () => {
    const keywords = normalizeChannelKeywords({
      additional: { tp_in_pips: true, delimiters: '|' },
    })
    const msg = `Gold sell now
ZN: 4105-4113
TP: 30/50/100
SL: 4120`
    const result = parseChannelMessageSync(msg, keywords, null)
    assert.equal(result.status, 'parsed')
    assert.deepEqual(result.parsed.tp, [30, 50, 100])
    assert.equal(result.parsed.tp_unit, 'pips')
  })

  it('does not treat +30 pips running chatter as an entry TP ladder', () => {
    const msg = '+50 pips running, you can move stop to breakeven.'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.notEqual(result.parsed.action, 'buy')
    assert.notEqual(result.parsed.action, 'sell')
  })
})

describe('deriveManualStopsWithClamp pip TP conversion', () => {
  it('converts parsed tp_unit=pips using entry zone mid', () => {
    const entry = 4109
    const { finalTps, finalSl, pip } = deriveManualStopsWithClamp({
      parsed: {
        action: 'sell',
        symbol: 'XAUUSD',
        entry_price: null,
        entry_zone_low: 4105,
        entry_zone_high: 4113,
        sl: 4120,
        tp: [30, 50, 100],
        tp_unit: 'pips',
        sl_unit: 'price',
        lot_size: null,
      },
      manual: {},
      channelKeywords: null,
      resolvedSymbol: 'XAUUSD',
      ctx: {
        point: 0.01,
        digits: 2,
        minLot: 0.01,
        lotStep: 0.01,
        contractSize: 100,
        stopsLevel: 0,
        freezeLevel: 0,
        defaultLot: 0.01,
        lastBalance: 10000,
      },
      entryAnchor: entry,
      isBuy: false,
    })
    assert.equal(pip, 0.01)
    assert.equal(finalSl, 4120)
    assert.deepEqual(
      finalTps.map(t => Number(t.toFixed(2))),
      [4108.7, 4108.5, 4108],
    )
  })
})
