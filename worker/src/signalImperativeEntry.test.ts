import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { messageHasImperativeEntryPhrase } from './signalImperativeEntry'

describe('messageHasImperativeEntryPhrase', () => {
  it('detects gold buy now and channel SELL alias', () => {
    assert.equal(messageHasImperativeEntryPhrase('Gold buy now'), true)
    assert.equal(
      messageHasImperativeEntryPhrase('SELL GOLD 2655\nSL 2665', { signal: { buy: 'BUY', sell: 'SELL' } }),
      true,
    )
  })

  it('rejects prose selling gold without imperative', () => {
    const msg = 'This trade we right now in, selling gold, has a high potential of a very big drop.'
    assert.equal(messageHasImperativeEntryPhrase(msg), false)
  })

  it('accepts labeled SL/TP structure via hasExecutableTradeStructure', () => {
    assert.equal(messageHasImperativeEntryPhrase('Gold buy now\nSL: 4458\nTP: 4467'), true)
  })
})
