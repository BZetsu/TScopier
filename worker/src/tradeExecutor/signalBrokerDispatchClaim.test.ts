import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claimSignalBrokerDispatch, isDuplicateKeyError } from './signalBrokerDispatchClaim'

describe('signalBrokerDispatchClaim', () => {
  it('isDuplicateKeyError detects postgres unique violations', () => {
    assert.equal(isDuplicateKeyError({ code: '23505' }), true)
    assert.equal(isDuplicateKeyError({ message: 'duplicate key value violates unique constraint' }), true)
    assert.equal(isDuplicateKeyError({ message: 'connection refused' }), false)
    assert.equal(isDuplicateKeyError(null), false)
  })

  it('claimSignalBrokerDispatch returns true on clean insert', async () => {
    const supabase = {
      from() {
        return {
          insert: async () => ({ error: null }),
        }
      },
    }
    assert.equal(await claimSignalBrokerDispatch(supabase as never, 's1', 'b1'), true)
  })

  it('claimSignalBrokerDispatch returns false on duplicate key', async () => {
    const supabase = {
      from() {
        return {
          insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
        }
      },
    }
    assert.equal(await claimSignalBrokerDispatch(supabase as never, 's1', 'b1'), false)
  })

  it('claimSignalBrokerDispatch fails closed on other insert errors', async () => {
    const logs: unknown[] = []
    const supabase = {
      from(table: string) {
        return {
          insert: async (row: unknown) => {
            if (table === 'trade_execution_logs') {
              logs.push(row)
              return { error: null }
            }
            return { error: { code: '57014', message: 'statement timeout' } }
          },
        }
      },
    }
    assert.equal(await claimSignalBrokerDispatch(supabase as never, 's1', 'b1', 'u1'), false)
    assert.equal(logs.length, 1)
    assert.equal((logs[0] as { action: string; user_id: string }).action, 'dispatch_claim_error')
    assert.equal((logs[0] as { user_id: string }).user_id, 'u1')
  })

  it('claimSignalBrokerDispatch skips error log when user_id missing', async () => {
    const logs: unknown[] = []
    const supabase = {
      from(table: string) {
        return {
          insert: async (row: unknown) => {
            if (table === 'trade_execution_logs') {
              logs.push(row)
              return { error: null }
            }
            return { error: { code: '57014', message: 'statement timeout' } }
          },
        }
      },
    }
    assert.equal(await claimSignalBrokerDispatch(supabase as never, 's1', 'b1'), false)
    assert.equal(logs.length, 0)
  })
})
