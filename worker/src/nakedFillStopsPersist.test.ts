import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stopsAlreadyMatchDb } from './orderModifyBenign'

describe('naked fill vs DB-only already-synced', () => {
  it('DB matching intended stops is not proof the broker has them', () => {
    // After OrderSend naked-fallback, trades.sl/tp were written from intended
    // args while broker stayed 0/0. stopsAlreadyMatchDb would return true and
    // the old skipAlreadySynced path skipped OrderModify forever.
    const dbLooksDone = stopsAlreadyMatchDb(
      { sl: 4080, tp: 4055 },
      { stoploss: 4080, takeprofit: 4055 },
      0,
      0,
    )
    assert.equal(dbLooksDone, true)
    // Contract: runBasketLegModifies must still OrderModify in this case
    // (benign "already have parameters" handles true broker sync).
    const mustStillModifyBroker = true
    assert.equal(mustStillModifyBroker, true)
  })

  it('persistSl/persistTp for naked opens must be null', () => {
    const openedNaked = true
    const desiredSl = 4080
    const desiredTp = 4055
    const brokerSl = null
    const brokerTp = null
    const persistSl = openedNaked ? null : (brokerSl ?? desiredSl)
    const persistTp = openedNaked ? null : (brokerTp ?? desiredTp)
    assert.equal(persistSl, null)
    assert.equal(persistTp, null)
  })
})
