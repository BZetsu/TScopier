import { normalizedErrorCode } from './sentryRedaction'
import {
  captureBusinessIssue,
  type BusinessEventCategory,
  type BusinessSeverity,
  type UserImpact,
} from './businessEvents'
import type { WorkerSentryContextInput } from './sentryContext'

export type DeferredBusinessFailureInput = {
  category: BusinessEventCategory
  event: string
  reasonCode?: string
  message: string
  severity?: BusinessSeverity
  userImpact: Exclude<UserImpact, 'none'>
  operation: string
  context?: WorkerSentryContextInput
  err?: unknown
  dedupeKey?: string
  fingerprint?: string[]
}

function safeErrorSummary(err: unknown): string | null {
  if (err == null) return null
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(
      /\b(session_string|account_number|password|token|secret|api_key|auth_key|authorization|phone|email)\s*[:=]\s*[^,\s]+/gi,
      '$1=[REDACTED]',
    )
    .slice(0, 300)
}

export function captureDeferredBusinessFailure(args: DeferredBusinessFailureInput): void {
  try {
    const reasonCode = args.reasonCode ?? normalizedErrorCode(args.err, 'DEFERRED_OPERATION_FAILED')
    captureBusinessIssue({
      category: args.category,
      event: args.event,
      severity: args.severity ?? 'error',
      reasonCode,
      message: args.message,
      userImpact: args.userImpact,
      dedupeKey: args.dedupeKey,
      fingerprint: args.fingerprint,
      context: {
        ...(args.context ?? {}),
        operation: args.context?.operation ?? args.operation,
        stage: args.context?.stage ?? 'deferred_follow_up',
        extra: {
          ...(args.context?.extra ?? {}),
          user_visible_state_may_be_stale: true,
          broker_database_state_may_disagree: true,
          error: safeErrorSummary(args.err),
        },
      },
    })
  } catch {
    // Deferred observability must never affect trade outcomes.
  }
}
