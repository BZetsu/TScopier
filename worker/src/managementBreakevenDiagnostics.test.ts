import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildManagementBreakevenAggregateDiagnostic,
  buildManagementBreakevenFailureDiagnostic,
  buildMgmtSweepExhaustionPayload,
  formatBreakevenReconcileLastError,
  managementBreakevenAggregatePayload,
  managementBreakevenFailurePayload,
  safeBuildManagementBreakevenAggregateDiagnostic,
  safeBuildManagementBreakevenFailureDiagnostic,
  safeBuildMgmtSweepExhaustionPayload,
  safeFormatBreakevenReconcileLastError,
  safeManagementBreakevenAggregatePayload,
  safeManagementBreakevenFailurePayload,
  type ManagementBreakevenFailureDiagnostic,
} from './managementBreakevenDiagnostics'
import { TradeExecutor } from './tradeExecutor/TradeExecutor'

function diagnostic(reasonCode: string): ManagementBreakevenFailureDiagnostic {
  return {
    operation: 'management_breakeven',
    reason_code: reasonCode,
    failure_reason: reasonCode,
    failure_phase: 'order_modify',
    trade_failure: {
      reasonCode,
      category: 'broker',
      title: reasonCode,
      explanation: reasonCode,
      retryable: false,
      userActionRequired: false,
    },
    support_investigation: 'review_broker_modify_and_reconcile_logs',
  }
}

function throwDiagnostic(): never {
  throw new Error('tok' + 'en=example password=example')
}

function mockSweepSupabase(opts?: {
  sourceLogs?: unknown[]
  rejectDiagnosticInsert?: boolean
}) {
  const updates: Array<{ table: string; payload: unknown }> = []
  const inserts: Array<{ table: string; payload: unknown }> = []
  const queryChain = {
    eq: () => queryChain,
    in: () => queryChain,
    order: () => queryChain,
    limit: () => Promise.resolve({ data: opts?.sourceLogs ?? [], error: null }),
    maybeSingle: () => Promise.resolve({ data: { user_id: 'user-1' }, error: null }),
  }
  const supabase = {
    from(table: string) {
      return {
        select: () => queryChain,
        update(payload: unknown) {
          const updateChain = {
            eq: () => updateChain,
            then: (
              resolve: (value: { data: null; error: null }) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => {
              updates.push({ table, payload })
              return Promise.resolve({ data: null, error: null }).then(resolve, reject)
            },
          }
          return updateChain
        },
        insert(payload: unknown) {
          inserts.push({ table, payload })
          if (opts?.rejectDiagnosticInsert) {
            return Promise.reject(new Error('diagnostic insert unavailable'))
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
  return { supabase, updates, inserts }
}

async function finalizeStuckMgmtSignalForTest(executor: TradeExecutor, signalId: string): Promise<void> {
  await (executor as unknown as {
    finalizeStuckMgmtSignal(signalId: string): Promise<void>
  }).finalizeStuckMgmtSignal(signalId)
}

describe('management breakeven diagnostics', () => {
  it('all breakeven legs succeed produces no underlying failure metadata', () => {
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 4,
      failedCount: 0,
      eligibleCount: 4,
      diagnostics: [],
    })

    assert.equal(aggregate.partial_failure, false)
    assert.equal(aggregate.failed_count, 0)
    assert.deepEqual(aggregate.underlying_reason_codes, [])
    assert.deepEqual(managementBreakevenAggregatePayload(aggregate).underlying_reason_codes, [])
  })

  it('normalizes invalid stops into safe per-leg metadata', () => {
    const diag = buildManagementBreakevenFailureDiagnostic('Invalid stops')
    const payload = managementBreakevenFailurePayload(diag)

    assert.equal(payload.management_operation, 'management_breakeven')
    assert.equal(payload.reason_code, 'INVALID_STOPS')
    assert.equal(payload.failure_reason, 'INVALID_STOPS')
    assert.equal(payload.failure_phase, 'order_modify')
    assert.equal((payload.trade_failure as { reasonCode?: string }).reasonCode, 'INVALID_STOPS')
  })

  it('normalizes broker timeout into safe per-leg metadata', () => {
    const diag = buildManagementBreakevenFailureDiagnostic('TradingHelper.OrderModify timed out')
    const payload = managementBreakevenFailurePayload(diag)

    assert.equal(payload.reason_code, 'BROKER_TIMEOUT')
    assert.equal((payload.trade_failure as { retryable?: boolean }).retryable, false)
    assert.equal(payload.support_investigation, 'check_broker_latency_and_reconcile_before_retry')
  })

  it('normalizes unknown broker failure safely without raw text in structured metadata', () => {
    const raw = 'OrderModify rejected by broker tok' + 'en=example password=example'
    const payload = managementBreakevenFailurePayload(buildManagementBreakevenFailureDiagnostic(raw))
    const serialized = JSON.stringify(payload).toLowerCase()

    assert.equal(payload.reason_code, 'BROKER_ORDER_REJECTED')
    assert.equal(serialized.includes('example'), false)
    assert.equal(serialized.includes('ordermodify rejected'), false)
  })

  it('diagnostic construction failures degrade to no per-leg metadata', () => {
    const warnings: string[] = []
    const diag = safeBuildManagementBreakevenFailureDiagnostic('Invalid stops', {
      build: throwDiagnostic,
      warn: message => warnings.push(message),
    })
    const requestPayload = {
      ticket: 123,
      action: 'breakeven',
      ...safeManagementBreakevenFailurePayload(diag),
    }

    assert.equal(diag, null)
    assert.deepEqual(requestPayload, { ticket: 123, action: 'breakeven' })
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]!.includes('example'), false)
  })

  it('diagnostic payload failures degrade to no per-leg metadata', () => {
    const warnings: string[] = []
    const requestPayload = {
      ticket: 123,
      action: 'partial_breakeven',
      ...safeManagementBreakevenFailurePayload(diagnostic('INVALID_STOPS'), {
        build: throwDiagnostic,
        warn: message => warnings.push(message),
      }),
    }

    assert.deepEqual(requestPayload, { ticket: 123, action: 'partial_breakeven' })
    assert.equal(warnings.length, 1)
  })

  it('multiple legs with the same reason keep bounded aggregate counts', () => {
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 3,
      failedCount: 2,
      eligibleCount: 5,
      diagnostics: [diagnostic('INVALID_STOPS'), diagnostic('INVALID_STOPS')],
    })

    assert.deepEqual(aggregate.underlying_reason_codes, ['INVALID_STOPS'])
    assert.deepEqual(aggregate.underlying_reason_counts, { INVALID_STOPS: 2 })
    assert.equal(aggregate.success_count, 3)
    assert.equal(aggregate.failed_count, 2)
    assert.equal(aggregate.partial_failure, true)
  })

  it('multiple different reasons are distinct and capped', () => {
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 1,
      failedCount: 6,
      eligibleCount: 7,
      diagnostics: [
        diagnostic('INVALID_STOPS'),
        diagnostic('BROKER_TIMEOUT'),
        diagnostic('POSITION_GONE'),
        diagnostic('MARKET_CLOSED'),
        diagnostic('BROKER_ACCOUNT_UNAVAILABLE'),
        diagnostic('BROKER_RATE_LIMITED'),
      ],
    })

    assert.deepEqual(aggregate.underlying_reason_codes, [
      'INVALID_STOPS',
      'BROKER_TIMEOUT',
      'POSITION_GONE',
      'MARKET_CLOSED',
      'BROKER_ACCOUNT_UNAVAILABLE',
    ])
    assert.equal(aggregate.truncated_underlying_reason_codes, true)
    assert.equal(Object.keys(aggregate.underlying_reason_counts).length, 5)
  })

  it('aggregate diagnostic failures preserve generic event context', () => {
    const warnings: string[] = []
    const aggregate = safeBuildManagementBreakevenAggregateDiagnostic({
      successCount: 3,
      failedCount: 1,
      eligibleCount: 4,
      diagnostics: [diagnostic('INVALID_STOPS')],
    }, {
      build: throwDiagnostic,
      warn: message => warnings.push(message),
    })
    const eventExtra = {
      ...safeManagementBreakevenAggregatePayload(aggregate),
      total_targeted_trades: 4,
      eligible_trade_count: 4,
      successful_count: 3,
      failed_count: aggregate?.failed_count ?? 1,
      partial_failure: true,
      reconcile_queued: true,
    }

    assert.equal(aggregate, null)
    assert.equal(eventExtra.total_targeted_trades, 4)
    assert.equal(eventExtra.successful_count, 3)
    assert.equal(eventExtra.failed_count, 1)
    assert.equal(warnings.length, 1)
  })

  it('aggregate payload failures preserve generic event context', () => {
    const warnings: string[] = []
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 3,
      failedCount: 1,
      eligibleCount: 4,
      diagnostics: [diagnostic('BROKER_TIMEOUT')],
    })
    const eventExtra = {
      ...safeManagementBreakevenAggregatePayload(aggregate, {
        build: throwDiagnostic,
        warn: message => warnings.push(message),
      }),
      total_targeted_trades: 4,
      successful_count: 3,
      failed_count: aggregate.failed_count,
    }

    assert.deepEqual(Object.keys(eventExtra).sort(), ['failed_count', 'successful_count', 'total_targeted_trades'])
    assert.equal(warnings.length, 1)
  })

  it('reconcile job text keeps existing prefix and adds safe underlying codes', () => {
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 3,
      failedCount: 1,
      eligibleCount: 4,
      diagnostics: [diagnostic('INVALID_STOPS')],
    })

    assert.equal(
      formatBreakevenReconcileLastError(1, aggregate),
      'Breakeven partial: 1 leg(s) did not verify at breakeven; underlying_reason_codes=INVALID_STOPS',
    )
  })

  it('reconcile diagnostic formatting failure falls back to legacy last_error', () => {
    const warnings: string[] = []
    const aggregate = buildManagementBreakevenAggregateDiagnostic({
      successCount: 3,
      failedCount: 1,
      eligibleCount: 4,
      diagnostics: [diagnostic('INVALID_STOPS')],
    })

    assert.equal(
      safeFormatBreakevenReconcileLastError(1, aggregate, {
        format: () => throwDiagnostic(),
        warn: message => warnings.push(message),
      }),
      'Breakeven partial: 1 leg(s) did not verify at breakeven',
    )
    assert.equal(warnings.length, 1)
  })

  it('sweep exhaustion keeps retry outcome separate from original cause', () => {
    const payload = buildMgmtSweepExhaustionPayload({
      sourceLogs: [
        { request_payload: { reason_code: 'INVALID_STOPS' } },
        { request_payload: { trade_failure: { reasonCode: 'BROKER_TIMEOUT' } } },
      ],
    })

    assert.equal(payload.retry_outcome, 'mgmt_sweep_max_redispatch')
    assert.equal(payload.failure_cause_preserved, true)
    assert.deepEqual(payload.underlying_reason_codes, ['INVALID_STOPS', 'BROKER_TIMEOUT'])
    assert.equal(payload.primary_underlying_reason_code, 'INVALID_STOPS')
  })

  it('sweep diagnostic construction failure returns neutral payload', () => {
    const warnings: string[] = []
    const payload = safeBuildMgmtSweepExhaustionPayload({ sourceLogs: [] }, {
      build: throwDiagnostic,
      warn: message => warnings.push(message),
    })

    assert.equal(payload.retry_outcome, 'mgmt_sweep_max_redispatch')
    assert.equal(payload.failure_cause_preserved, false)
    assert.deepEqual(payload.underlying_reason_codes, [])
    assert.equal(warnings.length, 1)
  })

  it('sweep finalization survives diagnostic payload construction failure', async () => {
    const poisonousLog = {}
    Object.defineProperty(poisonousLog, 'request_payload', {
      get: throwDiagnostic,
    })
    const { supabase, updates, inserts } = mockSweepSupabase({ sourceLogs: [poisonousLog] })
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      const executor = new TradeExecutor(supabase as never)
      await finalizeStuckMgmtSignalForTest(executor, 'signal-1')
    } finally {
      console.warn = originalWarn
    }

    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0]!.payload, { status: 'executed', skip_reason: 'mgmt_sweep_max_redispatch' })
    assert.equal(inserts.length, 1)
    assert.equal(
      ((inserts[0]!.payload as { request_payload: Record<string, unknown> }).request_payload).failure_cause_preserved,
      false,
    )
  })

  it('sweep finalization survives diagnostic DB insert rejection', async () => {
    const { supabase, updates, inserts } = mockSweepSupabase({
      sourceLogs: [{ request_payload: { reason_code: 'INVALID_STOPS' } }],
      rejectDiagnosticInsert: true,
    })
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      const executor = new TradeExecutor(supabase as never)
      await finalizeStuckMgmtSignalForTest(executor, 'signal-1')
    } finally {
      console.warn = originalWarn
    }

    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0]!.payload, { status: 'executed', skip_reason: 'mgmt_sweep_max_redispatch' })
    assert.equal(inserts.length, 1)
  })

  it('safe structured metadata excludes raw sensitive broker text', () => {
    const sensitiveText = [
      'Invalid stops',
      'tok' + 'en=example',
      'session' + '_string=example',
      'pass' + 'word=example',
      'raw' + '_payload={"auth":"example"}',
    ].join(' ')
    const diag = buildManagementBreakevenFailureDiagnostic(
      sensitiveText,
    )
    const serialized = JSON.stringify(managementBreakevenFailurePayload(diag)).toLowerCase()

    assert.equal(serialized.includes('example'), false)
    assert.equal(serialized.includes('session' + '_string'), false)
    assert.equal(serialized.includes('raw' + '_payload'), false)
    assert.equal(serialized.includes('invalid_stops'), true)
  })
})
