import { createHash } from 'node:crypto'
import { workerConfig, WORKER_BUILD_TAG } from '../workerConfig'
import type { PipelineCorrelationContext, PipelineTimestamps } from '../pipelineTimestamps'
import { parsePipelineTimestamps, pipelineSummaryPayload } from '../pipelineTimestamps'
import { safeForSentry } from './sentryRedaction'

export type WorkerSentryContextInput = PipelineCorrelationContext & {
  userId?: string | null
  signalId?: string | null
  id?: string | null
  telegramMessageId?: string | null
  channelId?: string | null
  brokerAccountId?: string | null
  pendingLegId?: string | null
  queueMessageId?: string | null
  executionAttemptId?: string | null
  dispatchSource?: string | null
  stage?: string | null
  operation?: string | null
  retry_attempt?: number | null
  execution_parent_id?: string | null
  basket_id?: string | null
  reconciliation_id?: string | null
  load_run_id?: string | null
  load_test?: boolean | null
  timestamps?: PipelineTimestamps | null
  extra?: Record<string, unknown>
}

function hashId(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
}

export function buildSafePipelineContext(input: WorkerSentryContextInput = {}): Record<string, unknown> {
  const ts = input.timestamps ? parsePipelineTimestamps(input.timestamps) : undefined
  const durations = ts ? pipelineSummaryPayload(ts) : undefined
  return safeForSentry({
    pipeline: {
      stage: input.stage ?? null,
      operation: input.operation ?? null,
      dispatch_source: input.dispatch_source ?? input.dispatchSource ?? null,
      signal_id: input.signal_id ?? input.signalId ?? input.id ?? null,
      channel_row_id: input.channel_id ?? input.channelId ?? null,
      telegram_message_id: input.telegram_message_id ?? input.telegramMessageId ?? null,
      broker_account_id: input.broker_account_id ?? input.brokerAccountId ?? null,
      execution_parent_id: input.execution_parent_id ?? null,
      execution_attempt_id: input.execution_attempt_id ?? input.executionAttemptId ?? null,
      pending_leg_id: input.pending_leg_id ?? input.pendingLegId ?? null,
      basket_id: input.basket_id ?? null,
      queue_message_id: input.queue_message_id ?? input.queueMessageId ?? null,
      reconciliation_id: input.reconciliation_id ?? null,
      retry_attempt: input.retry_attempt ?? null,
      load_run_id: input.load_run_id ?? null,
      load_test: input.load_test === true,
      user_hash: hashId(input.user_id ?? input.userId ?? null),
    },
    worker: {
      role: workerConfig.role,
      shard_id: workerConfig.shardId,
      shard_count: workerConfig.shardCount,
      build_tag: WORKER_BUILD_TAG,
    },
    durations,
    extra: input.extra ?? undefined,
  }) as Record<string, unknown>
}
