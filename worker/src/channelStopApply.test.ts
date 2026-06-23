import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allChannelModifySymbolBuckets,
  brokerOrderSlMatchesTarget,
  groupLegsByBrokerSignal,
  mgmtUseChannelStopApply,
  verifyLegStopOnBroker,
} from './channelStopApply'
import type { ChannelStopLeg } from './channelStopApply'
import type { MgmtTradeRow } from './managementScope'

describe('channelStopApply', () => {
  it('mgmtUseChannelStopApply defaults to true', () => {
    const prev = process.env.MGMT_USE_CHANNEL_STOP_APPLY
    delete process.env.MGMT_USE_CHANNEL_STOP_APPLY
    assert.equal(mgmtUseChannelStopApply(), true)
    process.env.MGMT_USE_CHANNEL_STOP_APPLY = 'false'
    assert.equal(mgmtUseChannelStopApply(), false)
    if (prev == null) delete process.env.MGMT_USE_CHANNEL_STOP_APPLY
    else process.env.MGMT_USE_CHANNEL_STOP_APPLY = prev
  })

  it('groupLegsByBrokerSignal groups by broker and anchor', () => {
    const legs: ChannelStopLeg[] = [
      {
        id: '1',
        signal_id: 'sig-a',
        broker_account_id: 'b1',
        metaapi_order_id: '10',
        symbol: 'XAUUSD',
        direction: 'sell',
        sl: 4100,
        tp: 4200,
        opened_at: '2026-06-20T10:00:00Z',
        entry_price: 4115,
        telegram_channel_id: 'ch-1',
      },
      {
        id: '2',
        signal_id: 'sig-a',
        broker_account_id: 'b2',
        metaapi_order_id: '11',
        symbol: 'XAUUSD',
        direction: 'sell',
        sl: 4100,
        tp: 4200,
        opened_at: '2026-06-20T10:01:00Z',
        entry_price: 4115,
        telegram_channel_id: 'ch-1',
      },
    ]
    const grouped = groupLegsByBrokerSignal(legs)
    assert.equal(grouped.size, 2)
    assert.equal(grouped.get('b1|sig-a')?.length, 1)
    assert.equal(grouped.get('b2|sig-a')?.length, 1)
  })

  it('verifyLegStopOnBroker compares broker order SL to target', () => {
    const map = new Map<number, unknown>([[100, { stopLoss: 4104 }]])
    assert.equal(verifyLegStopOnBroker(map, 100, 4104), true)
    assert.equal(verifyLegStopOnBroker(map, 100, 4100), false)
    assert.equal(brokerOrderSlMatchesTarget(4104, 4104), true)
  })

  it('allChannelModifySymbolBuckets returns every open trade for channel-wide modify', () => {
    const trades: MgmtTradeRow[] = [
      {
        id: 'g',
        signal_id: 'sig-1',
        broker_account_id: 'b1',
        metaapi_order_id: '1',
        symbol: 'XAUUSD',
        direction: 'sell',
        lot_size: 0.1,
        status: 'open',
        sl: null,
        tp: null,
        entry_price: 1,
        opened_at: '2026-01-01T10:00:00Z',
      },
      {
        id: 'e',
        signal_id: 'sig-1',
        broker_account_id: 'b1',
        metaapi_order_id: '2',
        symbol: 'EURUSD',
        direction: 'buy',
        lot_size: 0.1,
        status: 'open',
        sl: null,
        tp: null,
        entry_price: 1,
        opened_at: '2026-01-01T11:00:00Z',
      },
    ]
    assert.equal(allChannelModifySymbolBuckets(trades).length, 2)
  })
})
