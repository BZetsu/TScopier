import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPipelineCorrelation,
  emitPipelineEvent,
  parsePipelineTimestamps,
  pipelineSummaryPayload,
  redactForObservability,
  safeDurationMs,
  setPipelineTimestamp,
  type PipelineTimestamps,
} from './pipelineTimestamps'

describe('pipeline timestamp helpers', () => {
  it('keeps stable correlation fields across pipeline stages', () => {
    const correlation = buildPipelineCorrelation({
      userId: 'user-1',
      signalId: 'signal-1',
      telegramMessageId: 'tg-42',
      channelId: 'channel-1',
      brokerAccountId: 'broker-1',
      queueMessageId: '1690-0',
      executionAttemptId: 'attempt-1',
      brokerRequestId: 'request-1',
      dispatchSource: 'queue',
    })

    assert.deepEqual(correlation, {
      user_id: 'user-1',
      signal_id: 'signal-1',
      telegram_message_id: 'tg-42',
      channel_id: 'channel-1',
      broker_account_id: 'broker-1',
      queue_message_id: '1690-0',
      execution_attempt_id: 'attempt-1',
      broker_request_id: 'request-1',
      dispatch_source: 'queue',
      pending_leg_id: null,
      worker_role: null,
      shard_id: null,
    })
  })

  it('computes positive durations', () => {
    assert.equal(safeDurationMs(150, 100), 50)
  })

  it('returns null when timestamps are missing', () => {
    assert.equal(safeDurationMs(undefined, 100), null)
    assert.equal(safeDurationMs(150, undefined), null)
  })

  it('clamps out-of-order durations to zero', () => {
    assert.equal(safeDurationMs(100, 150), 0)
  })

  it('distinguishes Telegram source time from worker receipt time', () => {
    const ts: PipelineTimestamps = {
      telegram_source_message_at: 1000,
      telegram_message_received_at: 1300,
    }
    const summary = pipelineSummaryPayload(ts)
    assert.equal(summary.telegram_source_to_worker_receipt_ms, 300)
    assert.equal(summary.telegram_to_listener_ms, 300)
  })

  it('calculates queue wait from publish to consume', () => {
    const summary = pipelineSummaryPayload({
      queue_published_at: 2000,
      queue_consumed_at: 2600,
    })
    assert.equal(summary.queue_wait_ms, 600)
  })

  it('calculates broker request duration', () => {
    const summary = pipelineSummaryPayload({
      broker_request_started_at: 3000,
      broker_response_received_at: 3450,
    })
    assert.equal(summary.broker_request_ms, 450)
    assert.equal(summary.broker_send_ms, 450)
  })

  it('calculates receipt-to-broker-confirmation duration', () => {
    const summary = pipelineSummaryPayload({
      telegram_message_received_at: 1000,
      broker_execution_confirmed_at: 2400,
    })
    assert.equal(summary.telegram_receipt_to_broker_confirmation_ms, 1400)
    assert.equal(summary.total_ms, 1400)
  })

  it('maps new timestamp stages to legacy aliases for compatibility', () => {
    const ts = setPipelineTimestamp({}, 'broker_request_started_at', 5000)
    setPipelineTimestamp(ts, 'broker_response_received_at', 5125)
    const parsed = parsePipelineTimestamps(ts)!
    assert.equal(parsed.broker_request_started_at, 5000)
    assert.equal(parsed.t_first_broker_send, 5000)
    assert.equal(parsed.broker_response_received_at, 5125)
    assert.equal(parsed.t_last_broker_send, 5125)
  })

  it('emits duplicate-prevention events without sensitive payload fields', () => {
    const lines = captureConsoleLogs(() => {
      emitPipelineEvent({
        event: 'execution_duplicate_prevented',
        correlation: buildPipelineCorrelation({ userId: 'user-1', signalId: 'signal-1' }),
        timestamps: { queue_published_at: 10, queue_consumed_at: 20 },
        outcome: 'duplicate',
        extra: {
          authorization: 'Bearer secret',
          api_key: 'secret-key',
          safe_code: 'duplicate_claim',
        },
      })
    })

    assert.equal(lines.length, 1)
    const payload = JSON.parse(lines[0]!)
    assert.equal(payload.event, 'execution_duplicate_prevented')
    assert.equal(payload.authorization, '[REDACTED]')
    assert.equal(payload.api_key, '[REDACTED]')
    assert.equal(payload.safe_code, 'duplicate_claim')
  })

  it('emits ambiguous execution events', () => {
    const lines = captureConsoleLogs(() => {
      emitPipelineEvent({
        event: 'execution_ambiguous',
        correlation: buildPipelineCorrelation({
          userId: 'user-1',
          signalId: 'signal-1',
          brokerAccountId: 'broker-1',
        }),
        timestamps: {
          broker_request_started_at: 100,
          broker_response_received_at: 500,
        },
        outcome: 'failed',
        error_code: 'timed out',
      })
    })

    const payload = JSON.parse(lines[0]!)
    assert.equal(payload.event, 'execution_ambiguous')
    assert.equal(payload.error_code, 'timed out')
    assert.equal(payload.durations.broker_request_ms, 400)
  })

  it('redacts nested secret-looking fields and practical secret variants', () => {
    const redacted = redactForObservability({
      nested: {
        password: 'pw',
        session_string: 'session',
        service_role_key: 'service',
        serviceRoleKey: 'service-camel',
        supabase_service_role_key: 'supabase',
        auth_key: 'auth',
        authKey: 'auth-camel',
        telegram_auth_key: 'telegram-auth',
        bearer: 'bearer',
        cookie: 'cookie',
        'set-cookie': 'set-cookie',
        client_secret: 'client',
        clientSecret: 'client-camel',
        private_key: 'private',
        privateKey: 'private-camel',
        token: 'token',
        harmless: 'ok',
      },
    }) as Record<string, Record<string, string>>

    assert.equal(redacted.nested.password, '[REDACTED]')
    assert.equal(redacted.nested.session_string, '[REDACTED]')
    assert.equal(redacted.nested.service_role_key, '[REDACTED]')
    assert.equal(redacted.nested.serviceRoleKey, '[REDACTED]')
    assert.equal(redacted.nested.supabase_service_role_key, '[REDACTED]')
    assert.equal(redacted.nested.auth_key, '[REDACTED]')
    assert.equal(redacted.nested.authKey, '[REDACTED]')
    assert.equal(redacted.nested.telegram_auth_key, '[REDACTED]')
    assert.equal(redacted.nested.bearer, '[REDACTED]')
    assert.equal(redacted.nested.cookie, '[REDACTED]')
    assert.equal(redacted.nested['set-cookie'], '[REDACTED]')
    assert.equal(redacted.nested.client_secret, '[REDACTED]')
    assert.equal(redacted.nested.clientSecret, '[REDACTED]')
    assert.equal(redacted.nested.private_key, '[REDACTED]')
    assert.equal(redacted.nested.privateKey, '[REDACTED]')
    assert.equal(redacted.nested.token, '[REDACTED]')
    assert.equal(redacted.nested.harmless, 'ok')
  })

  it('does not throw when observability logging fails', () => {
    const original = console.log
    console.log = () => {
      throw new Error('logger down')
    }
    try {
      assert.doesNotThrow(() => emitPipelineEvent({
        event: 'broker_request_failed',
        correlation: buildPipelineCorrelation({ signalId: 'signal-1' }),
        timestamps: {},
        outcome: 'failed',
      }))
    } finally {
      console.log = original
    }
  })

  it('defers structured log serialization when requested', async () => {
    const original = console.log
    const lines: string[] = []
    console.log = (line?: unknown) => {
      lines.push(String(line))
    }
    try {
      emitPipelineEvent({
        event: 'broker_request_started',
        correlation: buildPipelineCorrelation({ signalId: 'signal-1' }),
        timestamps: { broker_request_started_at: 100 },
        outcome: 'started',
      }, { deferLog: true })
      assert.equal(lines.length, 0)

      await waitImmediate()
      assert.equal(lines.length, 1)
      assert.equal(JSON.parse(lines[0]!).event, 'broker_request_started')
    } finally {
      console.log = original
    }
  })

  it('deferred logging failures do not surface as unhandled rejections', async () => {
    const original = console.log
    console.log = () => {
      throw new Error('deferred logger down')
    }
    try {
      emitPipelineEvent({
        event: 'broker_request_started',
        correlation: buildPipelineCorrelation({ signalId: 'signal-1' }),
        timestamps: { broker_request_started_at: 100 },
      }, { deferLog: true })
      await waitImmediate()
    } finally {
      console.log = original
    }
  })

  it('supports fast-path and queued-path timestamp propagation', () => {
    const fast = setPipelineTimestamp({}, 'telegram_message_received_at', 100)
    setPipelineTimestamp(fast, 'queue_consumed_at', 120)
    setPipelineTimestamp(fast, 'broker_request_started_at', 180)
    assert.equal(pipelineSummaryPayload(fast).telegram_receipt_to_broker_request_ms, 80)

    const queued = setPipelineTimestamp({}, 'queue_publish_started_at', 200)
    setPipelineTimestamp(queued, 'queue_published_at', 220)
    setPipelineTimestamp(queued, 'queue_consumed_at', 520)
    assert.equal(pipelineSummaryPayload(queued).dispatch_ms, 20)
    assert.equal(pipelineSummaryPayload(queued).queue_wait_ms, 300)
  })

  it('preserves unrelated layering latency payload fields', () => {
    const ts = parsePipelineTimestamps({
      market_tick_received_at: 100,
      layer_cross_detected_at: 150,
      broker_request_started_at: 200,
    } as unknown)
    assert.equal((ts as Record<string, unknown>).market_tick_received_at, undefined)
    assert.equal(ts?.broker_request_started_at, 200)
  })
})

function captureConsoleLogs(fn: () => void): string[] {
  const original = console.log
  const lines: string[] = []
  console.log = (line?: unknown) => {
    lines.push(String(line))
  }
  try {
    fn()
  } finally {
    console.log = original
  }
  return lines
}

function waitImmediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}
