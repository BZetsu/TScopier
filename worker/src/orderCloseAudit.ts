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
const userIdByFxAccount = new Map<string, string>()

/** Register from worker boot so closes can persist to trade_execution_logs. */
export function registerOrderCloseAuditSink(next: AuditSink | null): void {
  sink = next
}

export function registerOrderCloseAuditSupabase(supabase: SupabaseClient): void {
  registerOrderCloseAuditSink((event) => {
    void (async () => {
      // The audit event only carries the FxSocket account id + ticket, but
      // trade_execution_logs requires user_id (NOT NULL) and signal_id.
      // Resolve user_id from broker_accounts (fxsocket_account_id) and, when
      // possible, signal_id from the owning trades row. If no user can be
      // resolved the DB write is skipped (console trail remains).
      let userId = userIdByFxAccount.get(event.accountId)
      let signalId: string | null = null
      if (!userId) {
        const { data: account } = await supabase
          .from('broker_accounts')
          .select('id, user_id')
          .eq('fxsocket_account_id', event.accountId)
          .maybeSingle()
        const acc = account as { id?: string; user_id?: string } | null
        userId = acc?.user_id ?? undefined
        if (userId) userIdByFxAccount.set(event.accountId, userId)
        if (acc?.id) {
          const { data: trade } = await supabase
            .from('trades')
            .select('signal_id')
            .eq('broker_account_id', acc.id)
            .eq('metaapi_order_id', String(event.ticket))
            .maybeSingle()
          signalId = ((trade as { signal_id?: string | null } | null)?.signal_id) ?? null
        }
      }
      if (!userId) {
        console.warn(
          `[orderCloseAudit] skip persist — no user_id for fx account=${event.accountId}`,
        )
        return
      }
      const { error } = await supabase.from('trade_execution_logs').insert({
        user_id: userId,
        ...(signalId ? { signal_id: signalId } : {}),
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
      if (error) {
        console.warn(`[orderCloseAudit] persist failed: ${error.message}`)
      }
    })()
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
