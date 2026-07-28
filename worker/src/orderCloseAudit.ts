/**
 * Central OrderClose audit — every broker close must leave a console + optional
 * DB trail so silent mass-closes can be attributed to a call stack.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type OrderCloseAuditEvent = {
  source: 'fxsocket' | 'fx_v2'
  accountId: string
  ticket: number
  volume?: number | null
  slippage?: number | null
  ok?: boolean
  message?: string | null
}

type AuditSink = (event: OrderCloseAuditEvent & { stack: string }) => void

let sink: AuditSink | null = null

/** Register from worker boot so closes can persist to trade_execution_logs. */
export function registerOrderCloseAuditSink(next: AuditSink | null): void {
  sink = next
}

export function registerOrderCloseAuditSupabase(supabase: SupabaseClient): void {
  registerOrderCloseAuditSink((event) => {
    void supabase
      .from('trade_execution_logs')
      .insert({
        action: 'order_close_audit',
        status: event.ok === false ? 'failed' : 'success',
        request_payload: {
          source: event.source,
          account_id: event.accountId,
          ticket: event.ticket,
          volume: event.volume ?? null,
          slippage: event.slippage ?? null,
          message: event.message ?? null,
          stack: event.stack.slice(0, 4000),
        } as unknown as Record<string, unknown>,
        error_message: event.ok === false ? (event.message ?? 'orderClose failed') : null,
      })
      .then(({ error }) => {
        if (error) {
          console.warn(`[orderCloseAudit] persist failed: ${error.message}`)
        }
      })
  })
}

/** Always log; optionally persist via registered sink. */
export function auditOrderClose(event: OrderCloseAuditEvent): void {
  const stack = (new Error('orderClose').stack ?? '').split('\n').slice(2, 18).join('\n')
  console.warn(
    `[orderCloseAudit] source=${event.source} account=${event.accountId}`
      + ` ticket=${event.ticket} volume=${event.volume ?? 'full'}`
      + ` ok=${event.ok ?? 'pending'}`
      + (event.message ? ` msg=${event.message}` : '')
      + `\n${stack}`,
  )
  try {
    sink?.({ ...event, stack })
  } catch (err) {
    console.warn(`[orderCloseAudit] sink error: ${(err as Error).message}`)
  }
}
