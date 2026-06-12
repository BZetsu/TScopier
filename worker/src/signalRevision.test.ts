import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  entryDispatchLooksSettleable,
  messageTextChanged,
  revisionDirectionFlippedFromActions,
  storedMessageDiffersFromTelegram,
} from './signalRevision'

describe('signalRevision', () => {
  it('messageTextChanged ignores outer whitespace', () => {
    assert.equal(messageTextChanged('Gold buy', ' Gold buy '), false)
    assert.equal(messageTextChanged('Gold buy', 'Gold buy now'), true)
  })

  it('storedMessageDiffersFromTelegram delegates to messageTextChanged', () => {
    assert.equal(storedMessageDiffersFromTelegram('a', 'b'), true)
  })

  it('revisionDirectionFlippedFromActions detects buy/sell flip', () => {
    assert.equal(revisionDirectionFlippedFromActions('buy', 'sell'), true)
    assert.equal(revisionDirectionFlippedFromActions('buy', 'buy'), false)
    assert.equal(revisionDirectionFlippedFromActions('modify', 'sell'), false)
  })

  it('entryDispatchLooksSettleable flags bare Gold buy now teaser', () => {
    assert.equal(entryDispatchLooksSettleable({
      action: 'buy',
      sl: null,
      tp: [],
    }), true)
    assert.equal(entryDispatchLooksSettleable({
      action: 'buy',
      sl: 4200,
      tp: [4215],
    }), false)
  })
})
