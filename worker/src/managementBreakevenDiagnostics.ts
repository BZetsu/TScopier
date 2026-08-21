import { tradeFailureReasonFromBrokerMessage, tradeFailureReasonFromCode, type TradeFailureReason } from './brokerTradeError'
import { classifyBrokerFailureReason } from './observability/businessEvents'
import { isBenignOrderModifyError, isPositionGoneError } from './orderModifyBenign'
import { isInvalidStopsError } from './orderModifySafe'

export const MANAGEMENT_BREAKEVEN_OPERATION = 'management_breakeven'
export const BREAKEVEN_PARTIAL_REASON_CODE = 'BREAKEVEN_PARTIAL'

const MAX_UNDERLYING_REASON_CODES = 5
const LEGACY_BREAKEVEN_RECONCILE_LAST_ERROR_PREFIX = 'Breakeven partial'

export type ManagementBreakevenFailurePhase =
  | 'order_modify'
  | 'breakeven_verify'
  | 'broker_position_lookup'

export type ManagementBreakevenFailureDiagnostic = {
  operation: typeof MANAGEMENT_BREAKEVEN_OPERATION
  reason_code: string
  failure_reason: string
  failure_phase: ManagementBreakevenFailurePhase
  trade_failure: TradeFailureReason
  support_investigation: string
}

export type ManagementBreakevenAggregateDiagnostic = {
  operation: typeof MANAGEMENT_BREAKEVEN_OPERATION
  reason_code: typeof BREAKEVEN_PARTIAL_REASON_CODE
  success_count: number
  failed_count: number
  eligible_count: number
  partial_failure: boolean
  underlying_reason_codes: string[]
  underlying_reason_counts: Record<string, number>
  primary_underlying_reason_code: string | null
  truncated_underlying_reason_codes: boolean
}

type DiagnosticWarningSink = (message: string) => void

function warnDiagnosticSkipped(area: string, err: unknown, warn: DiagnosticWarningSink = console.warn): void {
  try {
    const errType = err instanceof Error && err.name ? err.name : typeof err
    warn(`[tradeExecutor] management breakeven diagnostic skipped area=${area} error_type=${String(errType).slice(0, 40)}`)
  } catch {
    // Diagnostic warning must not affect trade management.
  }
}

function fallbackTradeFailure(reasonCode: string): TradeFailureReason {
  switch (reasonCode) {
    case 'INVALID_STOPS':
      return {
        reasonCode,
        category: 'broker',
        title: 'Breakeven stop was rejected',
        explanation: 'The broker rejected the breakeven stop update, usually because the requested stop was inside broker stop or freeze limits.',
        recommendedAction: 'Check broker stop/freeze levels, symbol mapping, and whether price moved while the breakeven update was being applied.',
        retryable: true,
        userActionRequired: false,
      }
    case 'POSITION_GONE':
      return {
        reasonCode,
        category: 'broker',
        title: 'Position was no longer open',
        explanation: 'The broker reported that the ticket was gone while the breakeven update was being applied.',
        recommendedAction: 'Check whether TP, SL, or a manual close removed the position before the management update completed.',
        retryable: false,
        userActionRequired: false,
      }
    default:
      return tradeFailureReasonFromCode(reasonCode) ?? {
        reasonCode,
        category: 'broker',
        title: 'Breakeven update was not confirmed',
        explanation: 'The broker did not confirm the breakeven stop update with a more specific recognized reason.',
        recommendedAction: 'Review the per-leg execution log and broker account state before retrying or escalating.',
        retryable: false,
        userActionRequired: true,
      }
  }
}

function classifyManagementBreakevenFailure(message: string): string {
  if (isPositionGoneError(message)) return 'POSITION_GONE'
  if (isBenignOrderModifyError(message)) return 'BENIGN_ORDER_MODIFY'
  if (isInvalidStopsError(message)) return 'INVALID_STOPS'
  const tradeFailure = tradeFailureReasonFromBrokerMessage(message)
  if (tradeFailure?.reasonCode) return tradeFailure.reasonCode
  return classifyBrokerFailureReason(message)
}

function phaseFromMessage(message: string): ManagementBreakevenFailurePhase {
  const lower = String(message ?? '').toLowerCase()
  if (/verify failed/.test(lower)) return 'breakeven_verify'
  if (/opened orders|ticket missing from opened orders|broker did not return stop loss/.test(lower)) {
    return 'broker_position_lookup'
  }
  return 'order_modify'
}

export function buildManagementBreakevenFailureDiagnostic(message: string): ManagementBreakevenFailureDiagnostic {
  const reasonCode = classifyManagementBreakevenFailure(message)
  const tradeFailure = fallbackTradeFailure(reasonCode)
  return {
    operation: MANAGEMENT_BREAKEVEN_OPERATION,
    reason_code: reasonCode,
    failure_reason: reasonCode,
    failure_phase: phaseFromMessage(message),
    trade_failure: tradeFailure,
    support_investigation:
      reasonCode === 'INVALID_STOPS'
        ? 'check_broker_stop_freeze_distance_and_price_move'
        : reasonCode === 'BROKER_TIMEOUT'
          ? 'check_broker_latency_and_reconcile_before_retry'
          : reasonCode === 'POSITION_GONE'
            ? 'check_whether_position_closed_before_management_update'
            : 'review_broker_modify_and_reconcile_logs',
  }
}

export function safeBuildManagementBreakevenFailureDiagnostic(
  message: string,
  opts?: {
    build?: typeof buildManagementBreakevenFailureDiagnostic
    warn?: DiagnosticWarningSink
  },
): ManagementBreakevenFailureDiagnostic | null {
  try {
    return (opts?.build ?? buildManagementBreakevenFailureDiagnostic)(message)
  } catch (err) {
    warnDiagnosticSkipped('per_leg_failure', err, opts?.warn)
    return null
  }
}

export function managementBreakevenFailurePayload(
  diagnostic: ManagementBreakevenFailureDiagnostic,
): Record<string, unknown> {
  return {
    management_operation: diagnostic.operation,
    reason_code: diagnostic.reason_code,
    failure_reason: diagnostic.failure_reason,
    failure_phase: diagnostic.failure_phase,
    trade_failure: diagnostic.trade_failure,
    support_investigation: diagnostic.support_investigation,
  }
}

export function safeManagementBreakevenFailurePayload(
  diagnostic: ManagementBreakevenFailureDiagnostic | null,
  opts?: {
    build?: typeof managementBreakevenFailurePayload
    warn?: DiagnosticWarningSink
  },
): Record<string, unknown> {
  if (!diagnostic) return {}
  try {
    return (opts?.build ?? managementBreakevenFailurePayload)(diagnostic)
  } catch (err) {
    warnDiagnosticSkipped('per_leg_payload', err, opts?.warn)
    return {}
  }
}

function boundedDistinctReasonCodes(values: string[]): {
  codes: string[]
  counts: Record<string, number>
  truncated: boolean
} {
  const counts: Record<string, number> = {}
  const codes: string[] = []
  for (const raw of values) {
    const code = String(raw ?? '').trim().toUpperCase()
    if (!code) continue
    counts[code] = (counts[code] ?? 0) + 1
    if (!codes.includes(code) && codes.length < MAX_UNDERLYING_REASON_CODES) {
      codes.push(code)
    }
  }
  return {
    codes,
    counts: Object.fromEntries(codes.map(code => [code, counts[code] ?? 0])),
    truncated: Object.keys(counts).length > codes.length,
  }
}

export function buildManagementBreakevenAggregateDiagnostic(args: {
  successCount: number
  failedCount: number
  eligibleCount: number
  diagnostics: ManagementBreakevenFailureDiagnostic[]
}): ManagementBreakevenAggregateDiagnostic {
  const distinct = boundedDistinctReasonCodes(args.diagnostics.map(d => d.reason_code))
  return {
    operation: MANAGEMENT_BREAKEVEN_OPERATION,
    reason_code: BREAKEVEN_PARTIAL_REASON_CODE,
    success_count: Math.max(0, args.successCount),
    failed_count: Math.max(0, args.failedCount),
    eligible_count: Math.max(0, args.eligibleCount),
    partial_failure: args.successCount > 0 && args.failedCount > 0,
    underlying_reason_codes: distinct.codes,
    underlying_reason_counts: distinct.counts,
    primary_underlying_reason_code: distinct.codes[0] ?? null,
    truncated_underlying_reason_codes: distinct.truncated,
  }
}

export function safeBuildManagementBreakevenAggregateDiagnostic(
  args: {
    successCount: number
    failedCount: number
    eligibleCount: number
    diagnostics: ManagementBreakevenFailureDiagnostic[]
  },
  opts?: {
    build?: typeof buildManagementBreakevenAggregateDiagnostic
    warn?: DiagnosticWarningSink
  },
): ManagementBreakevenAggregateDiagnostic | null {
  try {
    return (opts?.build ?? buildManagementBreakevenAggregateDiagnostic)(args)
  } catch (err) {
    warnDiagnosticSkipped('aggregate_failure', err, opts?.warn)
    return null
  }
}

export function managementBreakevenAggregatePayload(
  aggregate: ManagementBreakevenAggregateDiagnostic,
): Record<string, unknown> {
  return {
    management_operation: aggregate.operation,
    reason_code: aggregate.reason_code,
    failure_reason: aggregate.reason_code,
    success_count: aggregate.success_count,
    failed_count: aggregate.failed_count,
    eligible_count: aggregate.eligible_count,
    partial_failure: aggregate.partial_failure,
    underlying_reason_codes: aggregate.underlying_reason_codes,
    underlying_reason_counts: aggregate.underlying_reason_counts,
    primary_underlying_reason_code: aggregate.primary_underlying_reason_code,
    truncated_underlying_reason_codes: aggregate.truncated_underlying_reason_codes,
  }
}

export function safeManagementBreakevenAggregatePayload(
  aggregate: ManagementBreakevenAggregateDiagnostic | null,
  opts?: {
    build?: typeof managementBreakevenAggregatePayload
    warn?: DiagnosticWarningSink
  },
): Record<string, unknown> {
  if (!aggregate) return {}
  try {
    return (opts?.build ?? managementBreakevenAggregatePayload)(aggregate)
  } catch (err) {
    warnDiagnosticSkipped('aggregate_payload', err, opts?.warn)
    return {}
  }
}

export function legacyBreakevenReconcileLastError(failedCount: number): string {
  return `${LEGACY_BREAKEVEN_RECONCILE_LAST_ERROR_PREFIX}: ${Math.max(0, failedCount)} leg(s) did not verify at breakeven`
}

export function formatBreakevenReconcileLastError(
  failedCount: number,
  aggregate: ManagementBreakevenAggregateDiagnostic,
): string {
  const suffix = aggregate.underlying_reason_codes.length > 0
    ? `; underlying_reason_codes=${aggregate.underlying_reason_codes.join(',')}`
    : ''
  return `${legacyBreakevenReconcileLastError(failedCount)}${suffix}`
}

export function safeFormatBreakevenReconcileLastError(
  failedCount: number,
  aggregate: ManagementBreakevenAggregateDiagnostic | null,
  opts?: {
    format?: typeof formatBreakevenReconcileLastError
    warn?: DiagnosticWarningSink
  },
): string {
  if (!aggregate) return legacyBreakevenReconcileLastError(failedCount)
  try {
    return (opts?.format ?? formatBreakevenReconcileLastError)(failedCount, aggregate)
  } catch (err) {
    warnDiagnosticSkipped('reconcile_last_error', err, opts?.warn)
    return legacyBreakevenReconcileLastError(failedCount)
  }
}

function reasonCodeFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const tradeFailure = row.trade_failure && typeof row.trade_failure === 'object'
    ? row.trade_failure as Record<string, unknown>
    : null
  const code = row.reason_code ?? row.failure_reason ?? tradeFailure?.reasonCode
  return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null
}

export function buildMgmtSweepExhaustionPayload(args: {
  sourceLogs: Array<{ request_payload?: unknown }>
}): Record<string, unknown> {
  const distinct = boundedDistinctReasonCodes(
    args.sourceLogs.map(row => reasonCodeFromPayload(row.request_payload)).filter((v): v is string => Boolean(v)),
  )
  return {
    retry_outcome: 'mgmt_sweep_max_redispatch',
    management_operation: MANAGEMENT_BREAKEVEN_OPERATION,
    failure_cause_preserved: distinct.codes.length > 0,
    underlying_reason_codes: distinct.codes,
    underlying_reason_counts: distinct.counts,
    primary_underlying_reason_code: distinct.codes[0] ?? null,
    truncated_underlying_reason_codes: distinct.truncated,
  }
}

export function neutralMgmtSweepExhaustionPayload(): Record<string, unknown> {
  return {
    retry_outcome: 'mgmt_sweep_max_redispatch',
    management_operation: MANAGEMENT_BREAKEVEN_OPERATION,
    failure_cause_preserved: false,
    underlying_reason_codes: [],
    underlying_reason_counts: {},
    primary_underlying_reason_code: null,
    truncated_underlying_reason_codes: false,
  }
}

export function safeBuildMgmtSweepExhaustionPayload(
  args: {
    sourceLogs: Array<{ request_payload?: unknown }>
  },
  opts?: {
    build?: typeof buildMgmtSweepExhaustionPayload
    warn?: DiagnosticWarningSink
  },
): Record<string, unknown> {
  try {
    return (opts?.build ?? buildMgmtSweepExhaustionPayload)(args)
  } catch (err) {
    warnDiagnosticSkipped('sweep_exhaustion', err, opts?.warn)
    return neutralMgmtSweepExhaustionPayload()
  }
}
