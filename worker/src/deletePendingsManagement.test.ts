import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { applyManagement } from './tradeExecutor/managementExecutor'
import type { TradeExecutorContext } from './tradeExecutor/context'
import type { BrokerRow, SignalRow } from './tradeExecutor/types'

const originalKey = process.env.FXSOCKET_API_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.FXSOCKET_API_KEY
  else process.env.FXSOCKET_API_KEY = originalKey
})

function makeSignal(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'sig-mgmt-1',
    user_id: 'user-1',
    channel_id: 'ch-1',
    parsed_data: { action: 'delete_pendings' },
    status: 'parsed',
    parent_signal_id: 'sig-parent-1',
    is_modification: true,
    created_at: new Date().toISOString(),
    telegram_message_id: '200',
    reply_to_message_id: '100',
    ...overrides,
  } as SignalRow
}

function makeBroker(overrides: Partial<BrokerRow> = {}): BrokerRow {
  return {
    id: 'broker-1',
    user_id: 'user-1',
    metaapi_account_id: 'uuid-1',
    login: '1',
    server: 'Demo',
    platform: 'mt5',
    is_active: true,
    channel_message_filters: {},
    ...overrides,
  } as BrokerRow
}

function makeSupabase(opts: {
  entryPending?: boolean
  rangePending?: boolean
  signalUpdates?: Array<Record<string, unknown>>
  logs?: Array<Record<string, unknown>>
}) {
  const signalUpdates = opts.signalUpdates ?? []
  const logs = opts.logs ?? []
  return {
    from(table: string) {
      if (table === 'signals') {
        return {
          update(payload: Record<string, unknown>) {
            signalUpdates.push(payload)
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ error: null })
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'trade_execution_logs') {
        return {
          insert(row: Record<string, unknown>) {
            logs.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'signal_entry_pending_orders') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      eq() {
                        return {
                          limit() {
                            return Promise.resolve({
                              data: opts.entryPending ? [{ id: 'sep-1' }] : [],
                              error: null,
                            })
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'range_pending_legs') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      in() {
                        return {
                          limit() {
                            return Promise.resolve({
                              data: opts.rangePending ? [{ id: 'rpl-1' }] : [],
                              error: null,
                            })
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('applyManagement delete_pendings', () => {
  it('skips when not a reply', async () => {
    process.env.FXSOCKET_API_KEY = 'test-key'
    const logs: Array<Record<string, unknown>> = []
    const cancelCalls: unknown[] = []
    const ctx = {
      supabase: makeSupabase({ logs }),
      cancelRangePendingLegsForScopes: async (...args: unknown[]) => {
        cancelCalls.push(args)
      },
    } as unknown as TradeExecutorContext

    await applyManagement(
      ctx,
      makeSignal({ reply_to_message_id: null, parent_signal_id: 'sig-parent-1' }),
      { action: 'delete_pendings' } as never,
      [makeBroker()],
    )

    assert.equal(cancelCalls.length, 0)
    assert.equal(
      (logs.find(l => l.action === 'mgmt_skip')?.request_payload as { skip_reason?: string })?.skip_reason,
      'delete_pendings_requires_reply',
    )
  })

  it('skips when reply has no parent_signal_id', async () => {
    process.env.FXSOCKET_API_KEY = 'test-key'
    const logs: Array<Record<string, unknown>> = []
    const cancelCalls: unknown[] = []
    const ctx = {
      supabase: makeSupabase({ logs }),
      cancelRangePendingLegsForScopes: async (...args: unknown[]) => {
        cancelCalls.push(args)
      },
    } as unknown as TradeExecutorContext

    await applyManagement(
      ctx,
      makeSignal({ parent_signal_id: null }),
      { action: 'delete_pendings' } as never,
      [makeBroker()],
    )

    assert.equal(cancelCalls.length, 0)
    assert.equal(
      (logs.find(l => l.action === 'mgmt_skip')?.request_payload as { skip_reason?: string })?.skip_reason,
      'delete_pendings_no_parent',
    )
  })

  it('cancels only parent signal scopes when pending exists', async () => {
    process.env.FXSOCKET_API_KEY = 'test-key'
    const logs: Array<Record<string, unknown>> = []
    const signalUpdates: Array<Record<string, unknown>> = []
    const cancelCalls: unknown[] = []
    const ctx = {
      supabase: makeSupabase({ entryPending: true, logs, signalUpdates }),
      cancelRangePendingLegsForScopes: async (...args: unknown[]) => {
        cancelCalls.push(args)
      },
    } as unknown as TradeExecutorContext

    await applyManagement(
      ctx,
      makeSignal(),
      { action: 'delete_pendings' } as never,
      [makeBroker()],
    )

    assert.equal(cancelCalls.length, 1)
    const [userId, logSignalId, scopes, reason] = cancelCalls[0] as [
      string,
      string,
      Array<{ signalId: string; brokerAccountId: string }>,
      string,
    ]
    assert.equal(userId, 'user-1')
    assert.equal(logSignalId, 'sig-mgmt-1')
    assert.equal(reason, 'delete_pendings')
    assert.deepEqual(scopes, [{ signalId: 'sig-parent-1', brokerAccountId: 'broker-1', symbol: '' }])
    assert.ok(logs.some(l => l.action === 'delete_pendings' && l.status === 'success'))
    assert.ok(signalUpdates.some(u => u.status === 'executed'))
  })

  it('skips when no pending rows for parent', async () => {
    process.env.FXSOCKET_API_KEY = 'test-key'
    const logs: Array<Record<string, unknown>> = []
    const cancelCalls: unknown[] = []
    const ctx = {
      supabase: makeSupabase({ entryPending: false, rangePending: false, logs }),
      cancelRangePendingLegsForScopes: async (...args: unknown[]) => {
        cancelCalls.push(args)
      },
    } as unknown as TradeExecutorContext

    await applyManagement(
      ctx,
      makeSignal(),
      { action: 'delete_pendings' } as never,
      [makeBroker()],
    )

    assert.equal(cancelCalls.length, 0)
    assert.equal(
      (logs.find(l => l.action === 'mgmt_skip')?.request_payload as { skip_reason?: string })?.skip_reason,
      'delete_pendings_none',
    )
  })
})
