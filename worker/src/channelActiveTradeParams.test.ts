import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applyChannelParamsToVirtualLeg,
  mergeParsedWithChannelParams,
  symbolsForChannelParamsPersist,
} from './channelActiveTradeParams'

describe('channelActiveTradeParams', () => {
  test('mergeParsedWithChannelParams overlays SL and TP', () => {
    const out = mergeParsedWithChannelParams(
      {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: 4500,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: 4400,
        tp: [4600],
        lot_size: null,
      },
      { symbol: 'XAUUSD', stoploss: 4470, tpLevels: [4550, 4620] },
    )
    assert.equal(out.sl, 4470)
    assert.deepEqual(out.tp, [4550, 4620])
  })

  test('applyChannelParamsToVirtualLeg distributes TP by step', () => {
    const out = applyChannelParamsToVirtualLeg(
      { stoploss: 4400, takeprofit: 4600 },
      { symbol: 'XAUUSD', stoploss: 4470, tpLevels: [4550, 4620] },
      { stepIdx: 2, openLegCount: 4, tpLots: null },
    )
    assert.equal(out.stoploss, 4470)
    assert.ok(typeof out.takeprofit === 'number' && out.takeprofit > 0)
    assert.notEqual(out.takeprofit, 4600)
  })

  test('symbolsForChannelParamsPersist dedupes hints and trade symbols', () => {
    const syms = symbolsForChannelParamsPersist({
      symbolFromText: 'GOLD',
      tradeSymbols: ['XAUUSD', 'XAUUSD'],
      pendingSymbols: ['XAUUSDm'],
    })
    assert.ok(syms.includes('GOLD'))
    assert.ok(syms.includes('XAUUSD'))
    assert.ok(syms.includes('XAUUSDm'))
  })
})
