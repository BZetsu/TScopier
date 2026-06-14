import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  applyCloseTimesToTrades,
  buildTicketTimeLookup,
  mtTradeMissingDisplayTime,
} from './mtTradeTimestamps.ts'
import type { MtTrade } from './fxsocketBroker.ts'

test('buildTicketTimeLookup: FxSocket OrderHistory deal time', () => {
  const lookup = buildTicketTimeLookup([
    {
      ticket: 1401725372,
      symbol: 'XAUUSD',
      type: 'Sell',
      entry: 'Out',
      volume: 0.12,
      price: 4291.71,
      profit: 0,
      time: '2026-06-14T14:13:01Z',
    },
  ])
  const hit = lookup.get(1401725372)
  assert.ok(hit?.closed_at)
  assert.equal(new Date(hit!.closed_at!).toISOString(), '2026-06-14T14:13:01.000Z')
})

test('applyCloseTimesToTrades sets closed_at for closed trades', () => {
  const trade: MtTrade = {
    id: 'b:1401725372',
    broker_id: 'b',
    broker_label: 'Demo',
    broker_name: 'ICMarketsSC-Demo',
    ticket: 1401725372,
    symbol: 'XAUUSD',
    direction: 'sell',
    type: 'Sell',
    lot_size: 0.12,
    entry_price: 4291.71,
    sl: null,
    tp: null,
    close_price: null,
    profit: 0,
    swap: null,
    commission: null,
    comment: null,
    magic: null,
    opened_at: null,
    closed_at: null,
    state: null,
    status: 'closed',
  }
  assert.equal(mtTradeMissingDisplayTime(trade), true)
  const lookup = buildTicketTimeLookup([
    { ticket: 1401725372, time: '2026-06-14T14:13:01Z' },
  ])
  const [hydrated] = applyCloseTimesToTrades([trade], { b: lookup })
  assert.equal(mtTradeMissingDisplayTime(hydrated), false)
  assert.equal(hydrated.closed_at, '2026-06-14T14:13:01.000Z')
})
