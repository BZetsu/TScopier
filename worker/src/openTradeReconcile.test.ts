import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findGhostOpenTradeIds, reconcileOpenTradesForBroker } from './openTradeReconcile'

describe('findGhostOpenTradeIds', () => {
  it('returns ids for tickets absent from broker', () => {
    const ghost = findGhostOpenTradeIds(
      [
        { id: 'a', broker_account_id: 'b1', metaapi_order_id: '100' },
        { id: 'b', broker_account_id: 'b1', metaapi_order_id: '200' },
      ],
      new Set([200]),
    )
    assert.deepEqual(ghost, ['a'])
  })

  it('ignores rows without a valid ticket', () => {
    const ghost = findGhostOpenTradeIds(
      [
        { id: 'a', broker_account_id: 'b1', metaapi_order_id: null },
        { id: 'b', broker_account_id: 'b1', metaapi_order_id: '0' },
      ],
      new Set(),
    )
    assert.deepEqual(ghost, [])
  })

  it('returns empty when all tickets are on broker', () => {
    const ghost = findGhostOpenTradeIds(
      [{ id: 'a', broker_account_id: 'b1', metaapi_order_id: '100' }],
      new Set([100]),
    )
    assert.deepEqual(ghost, [])
  })
})

describe('reconcileOpenTradesForBroker', () => {
  it('does not mass-close when OpenedOrders is empty', async () => {
    const updates: unknown[] = []
    const supabase = {
      from(table: string) {
        assert.equal(table, 'trades')
        return {
          select() {
            return this
          },
          in() {
            return this
          },
          eq() {
            return this
          },
          update(payload: unknown) {
            updates.push(payload)
            return {
              in: () => ({
                eq: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              }),
            }
          },
        }
      },
    }
    const api = {
      openedOrders: async () => [],
    }
    const closed = await reconcileOpenTradesForBroker(
      supabase as never,
      api as never,
      'acct',
      [{ id: 'a', broker_account_id: 'b1', metaapi_order_id: '100' }],
    )
    assert.equal(closed, 0)
    assert.equal(updates.length, 0)
  })
})
