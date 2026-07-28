import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRangeLayerTillCloseEnabled,
  stopRangeLayeringUnlessEnabled,
} from './rangeLayerTillClose'

describe('isRangeLayerTillCloseEnabled', () => {
  it('returns false when unset or false', () => {
    assert.equal(isRangeLayerTillCloseEnabled(null), false)
    assert.equal(isRangeLayerTillCloseEnabled({}), false)
    assert.equal(isRangeLayerTillCloseEnabled({ range_layer_till_close: false }), false)
  })

  it('returns true only when explicitly enabled', () => {
    assert.equal(isRangeLayerTillCloseEnabled({ range_layer_till_close: true }), true)
  })
})

function chainable(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const self: Record<string, unknown> = {}
  const cont = () => self
  self.select = cont
  self.eq = cont
  self.in = cont
  self.delete = cont
  self.upsert = async () => ({ error: null })
  self.maybeSingle = async () => ({ data: result.data ?? null, error: result.error ?? null })
  self.then = (
    onfulfilled?: (value: { data: unknown; error: unknown; count?: number | null }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(onfulfilled as never, onrejected as never)
  return self
}

describe('stopRangeLayeringUnlessEnabled', () => {
  it('no-ops when layer till close is enabled and basket still open', async () => {
    let deleted = false
    const supabase = {
      from(table: string) {
        if (table === 'trades') {
          return chainable({ count: 2, data: null, error: null })
        }
        if (table === 'signals') {
          return chainable({ data: { channel_id: 'ch-1' }, error: null })
        }
        if (table === 'broker_accounts') {
          return chainable({
            data: {
              manual_settings: { range_layer_till_close: true },
              channel_trading_configs: {},
            },
            error: null,
          })
        }
        if (table === 'range_pending_legs') {
          deleted = true
        }
        return chainable({ data: null, error: null })
      },
    }
    const out = await stopRangeLayeringUnlessEnabled(
      supabase as never,
      { signalId: 'sig-1', brokerAccountId: 'broker-1', symbol: 'XAUUSD', userId: 'user-1' },
      'test',
    )
    assert.equal(out.stopped, false)
    assert.equal(deleted, false)
  })

  it('purges ladder when basket is fully flat even if layer till close is on', async () => {
    const calls: string[] = []
    const supabase = {
      from(table: string) {
        if (table === 'trades') {
          return chainable({ count: 0, data: null, error: null })
        }
        if (table === 'range_pending_legs') {
          calls.push('delete')
          return chainable({ data: [{ id: 'leg-1' }], error: null })
        }
        if (table === 'range_pending_tp_locks') {
          calls.push('lock')
          return {
            upsert: async () => {
              calls.push('lock')
              return { error: null }
            },
            delete: () => chainable({ data: null, error: null }),
          }
        }
        return chainable({ data: null, error: null })
      },
    }
    const out = await stopRangeLayeringUnlessEnabled(
      supabase as never,
      { signalId: 'sig-1', brokerAccountId: 'broker-1', symbol: 'XAUUSD', userId: 'user-1' },
      'basket_fully_closed',
    )
    assert.equal(out.stopped, true)
    assert.equal(out.deleted, 1)
    assert.ok(calls.includes('delete'))
    assert.ok(calls.includes('lock'))
  })

  it('deletes pendings and sets lock when disabled and basket still open', async () => {
    const calls: string[] = []
    const supabase = {
      from(table: string) {
        if (table === 'signals') {
          return chainable({ data: { channel_id: 'ch-1' }, error: null })
        }
        if (table === 'broker_accounts') {
          return chainable({
            data: {
              manual_settings: { range_layer_till_close: false },
              channel_trading_configs: {},
              copier_mode: 'manual',
              ai_settings: {},
              signal_channel_ids: [],
            },
            error: null,
          })
        }
        if (table === 'trades') {
          return chainable({ count: 2, data: null, error: null })
        }
        if (table === 'range_pending_legs') {
          calls.push(table)
          return chainable({ data: [{ id: 'leg-1' }], error: null })
        }
        if (table === 'range_pending_tp_locks') {
          return {
            upsert: async () => {
              calls.push('lock')
              return { error: null }
            },
          }
        }
        return chainable({ data: null, error: null })
      },
    }
    const out = await stopRangeLayeringUnlessEnabled(
      supabase as never,
      { signalId: 'sig-1', brokerAccountId: 'broker-1', symbol: 'XAUUSD', userId: 'user-1' },
      'partial_tp_close',
    )
    assert.equal(out.stopped, true)
    assert.equal(out.deleted, 1)
    assert.ok(calls.includes('range_pending_legs'))
    assert.ok(calls.includes('lock'))
  })
})
