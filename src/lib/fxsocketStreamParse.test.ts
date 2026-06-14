import { describe, expect, it } from 'vitest'
import {
  parseFxsocketAccountStreamData,
  parseFxsocketOpenPositionCount,
} from './fxsocketStreamParse'

describe('parseFxsocketAccountStreamData', () => {
  it('reads camelCase AccountSummary fields', () => {
    const snap = parseFxsocketAccountStreamData({
      balance: 10_000,
      equity: 10_050.5,
      profit: 50.5,
      currency: 'USD',
    })
    expect(snap.balance).toBe(10_000)
    expect(snap.equity).toBe(10_050.5)
    expect(snap.openPnl).toBe(50.5)
    expect(snap.currency).toBe('USD')
  })

  it('reads PascalCase fields from MT protobuf-style payloads', () => {
    const snap = parseFxsocketAccountStreamData({
      Balance: 5000,
      Equity: 4975,
      Profit: -25,
    })
    expect(snap.balance).toBe(5000)
    expect(snap.equity).toBe(4975)
    expect(snap.openPnl).toBe(-25)
  })

  it('derives floating P/L from equity minus balance when profit is absent', () => {
    const snap = parseFxsocketAccountStreamData({
      balance: 1000,
      equity: 1012.34,
    })
    expect(snap.openPnl).toBeCloseTo(12.34)
  })
})

describe('parseFxsocketOpenPositionCount', () => {
  it('counts only market positions, not pending orders', () => {
    expect(parseFxsocketOpenPositionCount([
      { kind: 'position', operation: 'Buy', ticket: 1 },
      { kind: 'pending', operation: 'BuyLimit', ticket: 2 },
      { operation: 'Sell', ticket: 3 },
      { type: 2, ticket: 4 },
    ])).toBe(2)
    expect(parseFxsocketOpenPositionCount([])).toBe(0)
    expect(parseFxsocketOpenPositionCount(null)).toBe(0)
  })
})

describe('countOpenMarketPositionsByBroker', () => {
  it('ignores pending MtTrade rows', () => {
    const counts = countOpenMarketPositionsByBroker([
      { broker_id: 'a', status: 'open', type: 'Buy' },
      { broker_id: 'a', status: 'open', type: 'Buy Limit' },
      { broker_id: 'b', status: 'closed', type: 'Sell' },
    ])
    expect(counts).toEqual({ a: 1 })
  })
})
