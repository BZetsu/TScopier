import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isBenignOrderModifyError, isPositionGoneError, stopsAlreadyMatchDb } from './orderModifyBenign'

describe('isPositionGoneError', () => {
  it('matches position-gone replies', () => {
    assert.equal(isPositionGoneError('unknown ticket'), true)
    assert.equal(isPositionGoneError('OrderClose: unknown ticket'), true)
    assert.equal(isPositionGoneError('invalid ticket'), true)
    assert.equal(isPositionGoneError('ticket 1297061 not found'), true)
    assert.equal(isPositionGoneError('no such order'), true)
    assert.equal(isPositionGoneError('already closed'), true)
  })

  it('does not match plain no-op or unrelated errors', () => {
    assert.equal(isPositionGoneError('Order already have this parameters (:52886408)'), false)
    assert.equal(isPositionGoneError('No changes'), false)
    assert.equal(isPositionGoneError('Symbol not found: BTCUSD'), false)
    assert.equal(isPositionGoneError('Not enough money'), false)
    assert.equal(isPositionGoneError(''), false)
  })
})

describe('isBenignOrderModifyError', () => {
  it('matches MT5 already-have-parameters message', () => {
    assert.equal(
      isBenignOrderModifyError('Order already have this parameters (:52886408)'),
      true,
    )
  })

  it('matches MT5 No changes retcode description', () => {
    assert.equal(isBenignOrderModifyError('No changes'), true)
  })

  it('matches gone-position replies as benign (unknown ticket etc.)', () => {
    assert.equal(isBenignOrderModifyError('unknown ticket'), true)
    assert.equal(isBenignOrderModifyError('OrderModify: unknown ticket'), true)
    assert.equal(isBenignOrderModifyError('invalid ticket'), true)
    assert.equal(isBenignOrderModifyError('ticket 1297061 not found'), true)
    assert.equal(isBenignOrderModifyError('no such order'), true)
    assert.equal(isBenignOrderModifyError('already closed'), true)
  })

  it('does not match unrelated errors', () => {
    assert.equal(isBenignOrderModifyError('Symbol not found: BTCUSD'), false)
    assert.equal(isBenignOrderModifyError('Not enough money'), false)
  })
})

describe('stopsAlreadyMatchDb for naked broker-pending fills', () => {
  it('does not treat null SL/TP as already synced when targets exist', () => {
    assert.equal(
      stopsAlreadyMatchDb(
        { sl: null, tp: null },
        { stoploss: 4040, takeprofit: 4100 },
        0,
        0,
      ),
      false,
    )
  })

  it('matches when DB already has the distributed targets', () => {
    assert.equal(
      stopsAlreadyMatchDb(
        { sl: 4040, tp: 4100 },
        { stoploss: 4040, takeprofit: 4100 },
        0,
        0,
      ),
      true,
    )
  })
})
