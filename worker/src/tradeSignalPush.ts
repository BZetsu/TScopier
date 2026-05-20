/**
 * Listener → trade worker HTTP push (split deploy). Supabase Realtime remains fallback.
 */

import { dispatchPriorityForAction, isManagementAction, parsedAction } from './tradeSignalActions'
import type { PipelineTimestamps } from './pipelineTimestamps'
import { shardForUserId } from './workerConfig'

export type TradeSignalPushPayload = {
  id: string
  user_id: string
  channel_id: string | null
  parsed_data: Record<string, unknown> | null
  status: string
  parent_signal_id?: string | null
  is_modification?: boolean
  telegram_message_id?: string | null
  reply_to_message_id?: string | null
  created_at?: string
  pipeline_ts?: PipelineTimestamps
}

function tradePushEnabled(): boolean {
  const v = String(process.env.TRADE_SIGNAL_PUSH_ENABLED ?? 'true').toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no'
}

function internalToken(): string {
  return String(process.env.WORKER_INTERNAL_TOKEN ?? '').trim()
}

function parseShardUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
}

function pickTradeWorkerUrl(action: string, userId?: string): string | null {
  const shardUrls = parseShardUrls(process.env.TRADE_WORKER_SHARD_URLS)
  const entryUrl = String(process.env.TRADE_WORKER_URL ?? '').trim().replace(/\/$/, '')
  const mgmtUrl = String(process.env.TRADE_MGMT_WORKER_URL ?? '').trim().replace(/\/$/, '')

  let base: string | null
  if (isManagementAction(action)) {
    base = mgmtUrl || entryUrl || null
  } else {
    base = entryUrl || null
  }

  if (shardUrls.length > 1 && userId) {
    const shard = shardForUserId(userId, shardUrls.length)
    const sharded = shardUrls[shard]
    if (sharded) {
      if (isManagementAction(action) && mgmtUrl) return mgmtUrl
      return sharded
    }
  }

  return base
}

/**
 * Fire-and-forget POST to trade worker. Never throws; logs failures only.
 */
export function pushParsedSignalToTradeWorker(row: TradeSignalPushPayload): void {
  if (!tradePushEnabled()) return
  const token = internalToken()
  if (!token) return

  const action = parsedAction(row.parsed_data as { action?: string })
  const baseUrl = pickTradeWorkerUrl(action, row.user_id)
  if (!baseUrl) return

  const timeoutMs = Math.max(
    500,
    Math.min(10_000, Number(process.env.TRADE_SIGNAL_PUSH_TIMEOUT_MS ?? 4_000)),
  )
  const url = `${baseUrl}/internal/dispatch-signal`
  const priority = dispatchPriorityForAction(action)

  const signalBody = {
    id: row.id,
    user_id: row.user_id,
    channel_id: row.channel_id,
    parsed_data: row.parsed_data,
    status: row.status,
    parent_signal_id: row.parent_signal_id ?? null,
    is_modification: row.is_modification ?? false,
    telegram_message_id: row.telegram_message_id ?? null,
    reply_to_message_id: row.reply_to_message_id ?? null,
    created_at: row.created_at,
    pipeline_ts: row.pipeline_ts,
  }

  void (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('trade-push-timeout'), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({ signal: signalBody, priority, source: 'listener_push' }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(
          `[tradeSignalPush] push failed signal=${row.id} status=${res.status} url=${baseUrl} ${text.slice(0, 200)}`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[tradeSignalPush] push error signal=${row.id} url=${baseUrl}: ${msg}`)
    } finally {
      clearTimeout(timer)
    }
  })()
}
