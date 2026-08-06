import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  modificationTargetsOpenTrade,
  resolveModificationParentSymbol,
} from './signalModificationGrounding'

const OPEN = [
  { symbol: 'XAUUSD', direction: 'SELL' },
  { symbol: 'EURUSD', direction: 'BUY' },
]

describe('modificationTargetsOpenTrade', () => {
  it('accepts a symbol with an open trade', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: 'XAUUSD' }, OPEN), true)
  })

  it('accepts case-insensitive symbol matches', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: 'xauusd' }, OPEN), true)
  })

  it('rejects a symbol with no open trade', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: 'GBPUSD' }, OPEN), false)
  })

  it('rejects a symbol whose trade is closed (not in open list)', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: 'EURUSD' }, [
      { symbol: 'XAUUSD', direction: 'SELL' },
    ]), false)
  })

  it('rejects a null symbol', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: null }, OPEN), false)
  })

  it('rejects an empty symbol', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: '  ' }, OPEN), false)
  })

  it('rejects when no open trades exist at all', () => {
    assert.equal(modificationTargetsOpenTrade({ symbol: 'XAUUSD' }, []), false)
  })
})

describe('resolveModificationParentSymbol', () => {
  it('no parent → no enforcement', () => {
    assert.deepEqual(resolveModificationParentSymbol({ parentSymbol: null, modelSymbol: 'EURUSD' }), { kind: 'no_parent' })
  })

  it('parent known + model omitted the symbol → fill with parent', () => {
    assert.deepEqual(resolveModificationParentSymbol({ parentSymbol: 'XAUUSD', modelSymbol: null }), { kind: 'fill', symbol: 'XAUUSD' })
  })

  it('parent known + model matches → ok', () => {
    assert.deepEqual(resolveModificationParentSymbol({ parentSymbol: 'XAUUSD', modelSymbol: 'xauusd' }), { kind: 'ok' })
  })

  it('parent known + model contradicts → conflict', () => {
    assert.deepEqual(
      resolveModificationParentSymbol({ parentSymbol: 'XAUUSD', modelSymbol: 'EURUSD' }),
      { kind: 'conflict', modelSymbol: 'EURUSD', parentSymbol: 'XAUUSD' },
    )
  })

  it('empty parent symbol → no enforcement', () => {
    assert.deepEqual(resolveModificationParentSymbol({ parentSymbol: '  ', modelSymbol: 'EURUSD' }), { kind: 'no_parent' })
  })

  it('empty model symbol → fill with parent', () => {
    assert.deepEqual(resolveModificationParentSymbol({ parentSymbol: 'XAUUSD', modelSymbol: '  ' }), { kind: 'fill', symbol: 'XAUUSD' })
  })
})
