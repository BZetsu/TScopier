import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractOpenOrderFromBrokerRaw,
  filterTscopierOrdersForChannelClose,
  type BrokerOpenOrderLike,
} from './managementBrokerClose'

describe('extractOpenOrderFromBrokerRaw', () => {
  it('parses MT5-style order object', () => {
    const o = extractOpenOrderFromBrokerRaw({
      ticket: 12345,
      symbol: 'XAUUSD',
      comment: 'TSCopier:SignalsPRO:abc12345',
      lots: 0.1,
      operation: 'Sell',
    })
    assert.deepEqual(o, {
      ticket: 12345,
      symbol: 'XAUUSD',
      comment: 'TSCopier:SignalsPRO:abc12345',
      lots: 0.1,
      isBuy: false,
    })
  })
})

describe('filterTscopierOrdersForChannelClose', () => {
  const orders: BrokerOpenOrderLike[] = [
    {
      ticket: 1,
      symbol: 'XAUUSD',
      comment: 'TSCopier:SignalsPRO:abc12345',
      lots: 0.1,
      isBuy: false,
    },
    {
      ticket: 2,
      symbol: 'EURUSD',
      comment: 'TSCopier:OtherCh:deadbeef',
      lots: 0.1,
      isBuy: true,
    },
    {
      ticket: 3,
      symbol: 'XAUUSD',
      comment: 'manual trade',
      lots: 0.1,
      isBuy: true,
    },
  ]

  it('filters by channel slug and TSCopier prefix', () => {
    const out = filterTscopierOrdersForChannelClose({
      orders,
      channelSlug: 'SignalsPRO',
      symbolFilter: null,
    })
    assert.equal(out.length, 1)
    assert.equal(out[0]!.ticket, 1)
  })

  it('filters by compatible symbol suffix', () => {
    const withSuffix: BrokerOpenOrderLike[] = [{
      ticket: 4,
      symbol: 'XAUUSDm',
      comment: 'TSCopier:SignalsPRO:abc12345',
      lots: 0.1,
      isBuy: false,
    }]
    const out = filterTscopierOrdersForChannelClose({
      orders: withSuffix,
      channelSlug: 'SignalsPRO',
      symbolFilter: 'XAUUSD',
    })
    assert.equal(out.length, 1)
    assert.equal(out[0]!.symbol, 'XAUUSDm')
  })
})
