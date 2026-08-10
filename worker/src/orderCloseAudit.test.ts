import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditOrderClose,
  registerOrderCloseAuditSupabase,
  registerOrderCloseAuditSink,
} from './orderCloseAudit'

function makeSupabaseMock() {
  const inserted: unknown[] = []
  const resolvedTrade: { user_id: string; signal_id: string } | null = null
  let insertError: { message: string } | null = null
  return {
    inserted,
    resolvedTrade,
    setResolvedTrade(trade: { user_id: string; signal_id: string } | null) {
      ;(mock as unknown as { _resolvedTrade: typeof trade })._resolvedTrade = trade
    },
    setInsertError(err: { message: string } | null) {
      ;(mock as unknown as { _insertError: typeof err })._insertError = err
    },
    supabase: {
      from: (table: string) => {
        if (table === 'trades') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: (mock as unknown as { _resolvedTrade: unknown })._resolvedTrade ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'trade_execution_logs') {
          return {
            insert: (row: unknown) => {
              inserted.push(row)
              return {
                maybeSingle: async () => ({ data: null, error: null }),
              }
            },
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: (mock as unknown as { _insertError: unknown })._insertError ?? null,
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      },
    },
  }
}

// The mock needs the mutable state above; build it lazily.
let mock: ReturnType<typeof makeSupabaseMock>

async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
}

describe('orderCloseAudit persistence', () => {
  it('persists with user_id + signal_id resolved from the trade row', async () => {
    mock = makeSupabaseMock()
    mock.setResolvedTrade({ user_id: 'user-1', signal_id: 'sig-1' })
    registerOrderCloseAuditSupabase(mock.supabase as never)

    auditOrderClose({
      source: 'fxsocket',
      accountId: 'broker-1',
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

  it('does not attempt the insert when the trade row is missing', async () => {
    mock = makeSupabaseMock()
    mock.setResolvedTrade(null)
    registerOrderCloseAuditSupabase(mock.supabase as never)

    auditOrderClose({
      source: 'fx_v2',
      accountId: 'broker-2',
      ticket: 42,
      ok: true,
    })
    await flush()
    registerOrderCloseAuditSink(null)

    assert.equal(mock.inserted.length, 0)
  })
})
