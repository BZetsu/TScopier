import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collapseIdenticalImmediateLegs } from './orderLegExecution'
import type { Leg } from './helpers'

function leg(partial: Partial<Leg['args']> & { comment: string; volume: number }): Leg {
  return {
    idx: 0,
    args: {
      symbol: 'XAUUSD',
      operation: 'Buy',
      price: 0,
      stoploss: 0,
      takeprofit: 0,
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
    const out = collapseIdenticalImmediateLegs(legs)
    assert.equal(out.legs.length, 1)
    assert.equal(out.collapsed, 2)
  })

  it('keeps distinct :tp legs', () => {
    const legs = [
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp1' }),
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp2' }),
      leg({ volume: 0.04, comment: 'TScopier:x:abc:tp3' }),
    ]
    const out = collapseIdenticalImmediateLegs(legs)
    assert.equal(out.legs.length, 3)
    assert.equal(out.collapsed, 0)
  })
})
