import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditOrderClose,
  registerOrderCloseAuditSupabase,
  registerOrderCloseAuditSink,
} from './orderCloseAudit'

function makeSupabaseMock() {
  const inserted: unknown[] = []
  const state = {
    account: null as { id?: string; user_id?: string } | null,
    trade: null as { signal_id?: string | null } | null,
  }
  return {
    state,
    inserted,
    supabase: {
      from: (table: string) => {
        if (table === 'broker_accounts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: state.account, error: null }),
              }),
            }),
          }
        }
        if (table === 'trades') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: state.trade, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'trade_execution_logs') {
          return {
            insert: (row: unknown) => {
              inserted.push(row)
              return {}
            },
          }
        }
        throw new Error(`unexpected table: ${table}`)
      },
    },
  }
}

async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
}

describe('orderCloseAudit persistence', () => {
  it('persists with user_id + signal_id resolved through broker_accounts → trades', async () => {
    const mock = makeSupabaseMock()
    mock.state.account = { id: 'broker-uuid', user_id: 'user-1' }
    mock.state.trade = { signal_id: 'sig-1' }
    registerOrderCloseAuditSupabase(mock.supabase as never)

    auditOrderClose({
      source: 'fxsocket',
      accountId: 'fx-account-1',
      ticket: 1278201,
      volume: 0.5,
      ok: false,
      message: 'unknown ticket',
    })
    await flush()
    registerOrderCloseAuditSink(null)

    assert.equal(mock.inserted.length, 1)
    const row = mock.inserted[0] as Record<string, unknown>
    assert.equal(row.user_id, 'user-1')
    assert.equal(row.signal_id, 'sig-1')
    assert.equal(row.action, 'order_close_audit')
    assert.equal(row.status, 'failed')
    assert.equal(row.error_message, 'unknown ticket')
  })

  it('inserts with user_id only when the trade row is missing', async () => {
    const mock = makeSupabaseMock()
    mock.state.account = { id: 'broker-uuid', user_id: 'user-1' }
    mock.state.trade = null
    registerOrderCloseAuditSupabase(mock.supabase as never)

    auditOrderClose({
      source: 'fx_v2',
      accountId: 'fx-account-2',
      ticket: 42,
      ok: true,
    })
    await flush()
    registerOrderCloseAuditSink(null)

    assert.equal(mock.inserted.length, 1)
    const row = mock.inserted[0] as Record<string, unknown>
    assert.equal(row.user_id, 'user-1')
    assert.equal(row.signal_id, undefined)
    assert.equal(row.status, 'success')
  })

  it('does not attempt the insert when no broker account resolves', async () => {
    const mock = makeSupabaseMock()
    mock.state.account = null
    registerOrderCloseAuditSupabase(mock.supabase as never)

    auditOrderClose({
      source: 'fxsocket',
      accountId: 'fx-account-3',
      ticket: 7,
      ok: false,
    })
    await flush()
    registerOrderCloseAuditSink(null)

    assert.equal(mock.inserted.length, 0)
  })
})
