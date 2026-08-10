import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collapseIdenticalImmediateLegs } from './collapseIdenticalImmediateLegs'
import type { Leg } from './types'

function leg(partial: Partial<Leg['args']> & { comment: string; volume: number }): Leg {
  return {
    idx: 0,
    args: {
      symbol: 'XAUUSD',
      operation: 'Buy',
      price: 0,
      stoploss: 4237,
      takeprofit: 4257,
      slippage: 20,
      expertID: 909090,
      ...partial,
    },
  }
}

describe('collapseIdenticalImmediateLegs', () => {
  it('keeps one of identical full-lot clones', () => {
    const legs = [
      leg({ volume: 0.4, comment: 'TScopier:44sClub:979b6ac0' }),
      leg({ volume: 0.4, comment: 'TScopier:44sClub:979b6ac0' }),
      leg({ volume: 0.4, comment: 'TScopier:44sClub:979b6ac0' }),
    ]
    const out = collapseIdenticalImmediateLegs(legs, { baseLot: 0.4 })
    assert.equal(out.legs.length, 1)
    assert.equal(out.collapsed, 2)
  })

  it('keeps distinct :tp legs', () => {
    const legs = [
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp1', takeprofit: 1900 }),
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp2', takeprofit: 1910 }),
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp3', takeprofit: 1920 }),
    ]
    const out = collapseIdenticalImmediateLegs(legs, { baseLot: 0.4 })
    assert.equal(out.legs.length, 3)
    assert.equal(out.collapsed, 0)
  })

  it('does not wipe ranging immediates when order comments are disabled', () => {
    // Real user pattern: range multi @ 0.4 lot / 4% legs → many 0.01 Buys with "".
    const legs = Array.from({ length: 14 }, (_, i) =>
      leg({
        volume: 0.01,
        comment: '',
        takeprofit: i < 6 ? 4257 : i < 10 ? 4259 : i < 13 ? 4261 : 4263,
      }),
    )
    const out = collapseIdenticalImmediateLegs(legs, { baseLot: 0.4 })
    assert.equal(out.legs.length, 14)
    assert.equal(out.collapsed, 0)
  })

  it('does not collapse granular legs when baseLot is unknown', () => {
    const legs = [
      leg({ volume: 0.01, comment: '' }),
      leg({ volume: 0.01, comment: '' }),
    ]
    const out = collapseIdenticalImmediateLegs(legs)
    assert.equal(out.legs.length, 2)
    assert.equal(out.collapsed, 0)
  })
})
