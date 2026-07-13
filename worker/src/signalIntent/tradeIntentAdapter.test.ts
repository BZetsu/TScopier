import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coerceTradeIntent } from './coerceTradeIntent'
import { tradeIntentToChannelParsedSignal } from './tradeIntentAdapter'
import { FRENCH_BUY_GOLD, PORTUGUESE_SCALP_SELL } from './fixtures/multilingualFixtures'

describe('coerceTradeIntent', () => {
  it('maps legacy buy action to BUY side', () => {
    const intent = coerceTradeIntent({
      kind: 'entry',
      action: 'buy',
      symbol: 'XAUUSD',
      entry_price: 3365,
      sl: 3355,
      tp: [3370, 3375, 3380],
      confidence: 0.97,
    })
    assert.equal(intent.side, 'BUY')
    assert.deepEqual(intent.entry, [3365])
    assert.deepEqual(intent.tp, [3370, 3375, 3380])
  })

  it('maps entry zone fields', () => {
    const intent = coerceTradeIntent({
      kind: 'entry',
      side: 'SELL',
      entry_zone_low: 2655,
      entry_zone_high: 2650,
      sl: 2665,
      tp: [2640],
    })
    assert.deepEqual(intent.entry, [2650, 2655])
  })
})

describe('tradeIntentToChannelParsedSignal', () => {
  it('maps French buy gold fixture', () => {
    const intent = coerceTradeIntent({
      kind: 'entry',
      side: 'BUY',
      symbol: 'XAUUSD',
      entry: [3365],
      sl: 3355,
      tp: [3370, 3375, 3380],
      sl_unit: 'price',
      tp_unit: 'price',
      flags: { re_enter: true },
      confidence: 0.97,
      detected_language: 'fr',
    })
    const parsed = tradeIntentToChannelParsedSignal(intent, FRENCH_BUY_GOLD.rawMessage)
    assert.equal(parsed.action, 'buy')
    assert.equal(parsed.symbol, 'XAUUSD')
    assert.equal(parsed.entry_price, 3365)
    assert.equal(parsed.sl, 3355)
    assert.deepEqual(parsed.tp, [3370, 3375, 3380])
  })

  it('maps Portuguese scalp sell fixture', () => {
    const intent = coerceTradeIntent({
      kind: 'entry',
      side: 'SELL',
      symbol: 'XAUUSD',
      entry: [4060],
      sl: 4080,
      tp: [4055, 4050, 4040],
      confidence: 0.99,
    })
    const parsed = tradeIntentToChannelParsedSignal(intent, PORTUGUESE_SCALP_SELL.rawMessage)
    assert.equal(parsed.action, 'sell')
    assert.equal(parsed.entry_price, 4060)
    assert.equal(parsed.sl, 4080)
    assert.deepEqual(parsed.tp, [4055, 4050, 4040])
  })

  it('maps modify kind', () => {
    const parsed = tradeIntentToChannelParsedSignal({
      kind: 'modify',
      side: 'SELL',
      symbol: 'XAUUSD',
      entry: [],
      sl: 4060,
      tp: [4035],
      sl_unit: 'price',
      tp_unit: 'price',
      flags: {},
      confidence: 0.9,
    }, 'SL 4060 TP 4035')
    assert.equal(parsed.action, 'modify')
  })
})
