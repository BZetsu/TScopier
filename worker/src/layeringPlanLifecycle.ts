import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketBrokerClient } from './fxsocketClient'

export type LayeringPlanLifecycleOutcome =
  | 'completed'
  | 'entries_complete'
  | 'not_ready'
  | 'cancelled'
  | 'cancellation_pending'
  | 'cancellation_manual_review'
  | 'invalid'
  | 'not_found'
  | 'failed'

const TERMINAL_LEG_STATUSES = new Set(['fired', 'filled', 'cancelled', 'expired', 'failed'])
const OPEN_NATIVE_SUBMISSION_STATUSES = new Set(['planned', 'submission_claimed', 'submission_ambiguous', 'reconciliation_required', 'submitted'])
type BrokerCancellationState = 'pending' | 'filled' | 'cancelled' | 'rejected' | 'missing' | 'unknown'

function terminalLeg(row: { status?: unknown; native_submission_status?: unknown }): boolean {
  const status = String(row.status ?? '')
  if (!TERMINAL_LEG_STATUSES.has(status)) return false
  const native = row.native_submission_status == null ? null : String(row.native_submission_status)
  return native == null || !OPEN_NATIVE_SUBMISSION_STATUSES.has(native)
}

function num(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function ticketMatches(row: unknown, ticket: number, reference: string | null): boolean {
  if (!row || typeof row !== 'object') return false
  const rec = row as Record<string, unknown>
  const rowTicket = num(rec.ticket ?? rec.Ticket ?? rec.order ?? rec.Order ?? rec.position ?? rec.Position)
  if (rowTicket === ticket) return true
  if (!reference) return false
  const comment = str(rec.comment ?? rec.Comment ?? rec.clientReference ?? rec.client_reference)
  return comment === reference
}

function isPendingOperation(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const rec = row as Record<string, unknown>
  const op = str(rec.operation ?? rec.Operation ?? rec.orderType ?? rec.OrderType ?? rec.type ?? rec.Type).toLowerCase()
  return /limit|stop/.test(op)
}

function classifyHistoricalOrder(row: unknown): BrokerCancellationState {
  if (!row || typeof row !== 'object') return 'unknown'
  const rec = row as Record<string, unknown>
  const state = str(rec.state ?? rec.State ?? rec.status ?? rec.Status ?? rec.reason ?? rec.Reason).toLowerCase()
  const closePrice = num(rec.closePrice ?? rec.ClosePrice)
  const profit = num(rec.profit ?? rec.Profit)
  if (/cancel|delete|deleted/.test(state)) return 'cancelled'
  if (/reject|expir|invalid/.test(state)) return 'rejected'
  if (/fill|filled|deal|closed|done/.test(state) || closePrice != null || profit != null) return 'filled'
  return 'unknown'
}

async function reconcileBrokerCancellationState(args: {
  readonly api: FxsocketBrokerClient
  readonly uuid: string
  readonly ticket: number
  readonly reference: string | null
}): Promise<BrokerCancellationState> {
  const opened = await args.api.openedOrders(args.uuid)
  const openMatch = opened.find(row => ticketMatches(row, args.ticket, args.reference))
  if (openMatch) return isPendingOperation(openMatch) ? 'pending' : 'filled'

  const maybeHistory = args.api as FxsocketBrokerClient & { closedOrders?: (id: string) => Promise<unknown[]> }
  if (typeof maybeHistory.closedOrders === 'function') {
    const history = await maybeHistory.closedOrders(args.uuid)
    const historyMatch = history.find(row => ticketMatches(row, args.ticket, args.reference))
    if (historyMatch) return classifyHistoricalOrder(historyMatch)
  }
  return 'missing'
}

function firstExecutionConfirmed(plan: Record<string, unknown>): boolean {
  const status = String(plan.first_execution_status ?? '')
  const orderId = typeof plan.first_execution_order_id === 'string' && plan.first_execution_order_id.trim()
  const fillPrice = num(plan.first_execution_fill_price)
  const filledLot = num(plan.first_execution_filled_lot)
  if (status !== 'confirmed' || !orderId || fillPrice == null || fillPrice <= 0 || filledLot == null || filledLot <= 0) {
    return false
  }
  const metadata = plan.layer_plan_metadata
  if (!metadata || typeof metadata !== 'object') return false
  const snap = metadata as { fundedPrices?: unknown; lots?: unknown; mode?: unknown }
  const prices = Array.isArray(snap.fundedPrices) ? snap.fundedPrices : []
  const lots = Array.isArray(snap.lots) ? snap.lots : []
  const expectedLot = num(lots[0])
  const expectedPrice = num(prices[0])
  return (
    expectedLot != null
    && Number(expectedLot.toFixed(8)) === Number(filledLot.toFixed(8))
    && (snap.mode !== 'dynamic' || expectedPrice == null || Number(expectedPrice.toFixed(8)) === Number(fillPrice.toFixed(8)))
  )
}

export async function convergeLayeringPlanAfterLegTerminal(
  supabase: SupabaseClient,
  planId: string | null | undefined,
): Promise<LayeringPlanLifecycleOutcome> {
  if (!planId) return 'not_ready'
  const { data: plan, error: planError } = await supabase
    .from('layering_plans')
    .select('layer_plan_id,status,layer_plan_metadata,first_execution_order_id,first_execution_status,first_execution_fill_price,first_execution_filled_lot,first_execution_confirmed_at')
    .eq('layer_plan_id', planId)
    .maybeSingle()
  if (planError) return 'failed'
  if (!plan) return 'not_found'
  const status = String((plan as { status?: unknown }).status ?? '')
  if (status === 'completed') return 'completed'
  if (status === 'entries_complete') return 'entries_complete'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'invalid') return 'invalid'
  if (status !== 'active') return 'not_ready'
  if (!firstExecutionConfirmed(plan as Record<string, unknown>)) return 'not_ready'

  const { data: legs, error: legsError } = await supabase
    .from('range_pending_legs')
    .select('id,status,native_submission_status')
    .eq('layer_plan_id', planId)
  if (legsError) return 'failed'
  if ((legs ?? []).length > 0 && !(legs as Array<{ status?: unknown; native_submission_status?: unknown }>).every(terminalLeg)) {
    return 'not_ready'
  }

  const { data: updated, error: updateError } = await supabase
    .from('layering_plans')
    .update({ status: 'entries_complete', updated_at: new Date().toISOString() })
    .eq('layer_plan_id', planId)
    .eq('status', 'active')
    .select('layer_plan_id')
    .maybeSingle()
  if (updateError) return 'failed'
  return updated ? 'entries_complete' : 'not_ready'
}

export async function markLayeringPlanInvalid(
  supabase: SupabaseClient,
  planId: string | null | undefined,
  reason: string,
): Promise<boolean> {
  if (!planId) return false
  const { data, error } = await supabase
    .from('layering_plans')
    .update({
      status: 'invalid',
      updated_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq('layer_plan_id', planId)
    .in('status', ['prepared', 'activating', 'active', 'cancelling', 'cancellation_pending', 'entries_complete'])
    .select('layer_plan_id')
    .maybeSingle()
  return !error && Boolean(data)
}

export async function cancelLayeringPlan(
  supabase: SupabaseClient,
  planId: string | null | undefined,
  reason: string,
  opts?: { readonly apiLookup?: (uuid: string) => FxsocketBrokerClient | null },
): Promise<LayeringPlanLifecycleOutcome> {
  if (!planId) return 'not_ready'
  const now = new Date().toISOString()
  const { data: plan, error: planError } = await supabase
    .from('layering_plans')
    .update({ status: 'cancelling', cancellation_reason: reason, updated_at: now })
    .eq('layer_plan_id', planId)
    .in('status', ['prepared', 'activating', 'active', 'cancelling', 'cancellation_pending'])
    .select('layer_plan_id,status')
    .maybeSingle()
  if (planError) return 'failed'
  if (!plan) return 'not_ready'

  const { data: legs, error: legsError } = await supabase
    .from('range_pending_legs')
    .select('id,status,metaapi_account_id,ticket,signal_id,user_id,broker_account_id,native_submission_status,broker_client_reference,cancellation_status,cancellation_requested_at')
    .eq('layer_plan_id', planId)
  if (legsError) return 'failed'

  let unresolvedNative = false
  let manualReviewNative = false
  for (const leg of (legs ?? []) as Array<Record<string, unknown>>) {
    const status = String(leg.status ?? '')
    const native = leg.native_submission_status == null ? null : String(leg.native_submission_status)
    if (TERMINAL_LEG_STATUSES.has(status) && (native == null || !OPEN_NATIVE_SUBMISSION_STATUSES.has(native))) continue
    if (status === 'broker_pending') {
      const ticket = Number(leg.ticket)
      const api = opts?.apiLookup?.(String(leg.metaapi_account_id ?? '')) ?? null
      if (!api || !Number.isFinite(ticket) || ticket <= 0) {
        unresolvedNative = true
        manualReviewNative = true
        await supabase
          .from('range_pending_legs')
          .update({
            cancellation_status: 'cancellation_manual_review',
            cancellation_reason: !api ? 'cancellation_api_unavailable' : 'cancellation_ticket_missing',
            error_message: reason,
          })
          .eq('id', leg.id)
        continue
      }
      let brokerState: BrokerCancellationState
      try {
        brokerState = await reconcileBrokerCancellationState({
          api,
          uuid: String(leg.metaapi_account_id),
          ticket,
          reference: typeof leg.broker_client_reference === 'string' ? leg.broker_client_reference : null,
        })
      } catch {
        unresolvedNative = true
        await supabase
          .from('range_pending_legs')
          .update({
            cancellation_status: 'cancellation_pending',
            cancellation_reason: 'broker_cancel_reconciliation_failed',
            error_message: reason,
          })
          .eq('id', leg.id)
        continue
      }
      if (brokerState === 'filled') {
        await supabase
          .from('range_pending_legs')
          .update({
            status: 'filled',
            cancellation_status: 'filled',
            cancellation_reason: 'broker_order_already_filled',
            error_message: reason,
          })
          .eq('id', leg.id)
          .eq('status', 'broker_pending')
        continue
      }
      if (brokerState === 'cancelled' || brokerState === 'rejected') {
        await supabase
          .from('range_pending_legs')
          .update({
            status: brokerState === 'cancelled' ? 'cancelled' : 'failed',
            cancellation_status: brokerState,
            cancellation_confirmed_at: now,
            cancellation_reason: `broker_order_${brokerState}`,
            error_message: reason,
          })
          .eq('id', leg.id)
          .eq('status', 'broker_pending')
        continue
      }
      if (brokerState === 'missing') {
        unresolvedNative = true
        manualReviewNative = true
        await supabase
          .from('range_pending_legs')
          .update({
            cancellation_status: 'cancellation_manual_review',
            cancellation_reason: 'broker_order_missing',
            error_message: reason,
          })
          .eq('id', leg.id)
        continue
      }
      if (leg.cancellation_requested_at || leg.cancellation_status === 'cancellation_pending') {
        unresolvedNative = true
        await supabase
          .from('range_pending_legs')
          .update({
            cancellation_status: 'cancellation_pending',
            cancellation_reason: 'broker_cancel_reconciliation_pending',
            error_message: reason,
          })
          .eq('id', leg.id)
        continue
      }
      const { data: claimedCancel, error: claimCancelError } = await supabase
        .from('range_pending_legs')
        .update({
          cancellation_status: 'cancellation_pending',
          cancellation_requested_at: now,
          cancellation_reason: 'broker_cancel_requested',
          error_message: reason,
        })
        .eq('id', leg.id)
        .eq('status', 'broker_pending')
        .is('cancellation_requested_at', null)
        .select('id')
        .maybeSingle()
      if (claimCancelError || !claimedCancel) {
        unresolvedNative = true
        continue
      }
      try {
        await api.orderClose(String(leg.metaapi_account_id), { ticket })
        await supabase
          .from('range_pending_legs')
          .update({
            status: 'cancelled',
            cancellation_status: 'cancelled',
            cancellation_confirmed_at: now,
            error_message: reason,
          })
          .eq('id', leg.id)
          .eq('status', 'broker_pending')
      } catch {
        unresolvedNative = true
        const msg = 'broker_cancel_unconfirmed'
        await supabase
          .from('range_pending_legs')
          .update({
            cancellation_status: 'cancellation_pending',
            cancellation_reason: msg,
            error_message: reason,
          })
          .eq('id', leg.id)
      }
      continue
    }
    await supabase
      .from('range_pending_legs')
      .update({ status: 'cancelled', error_message: reason, cancellation_status: 'cancelled', cancellation_confirmed_at: now })
      .eq('id', leg.id)
      .in('status', ['planned', 'pending', 'claimed'])
  }

  if (unresolvedNative) {
    const pendingStatus = manualReviewNative ? 'cancellation_manual_review' : 'cancellation_pending'
    await supabase
      .from('layering_plans')
      .update({ status: pendingStatus, updated_at: now, cancellation_reason: reason })
      .eq('layer_plan_id', planId)
      .in('status', ['cancelling', 'cancellation_pending'])
    return pendingStatus
  }
  await supabase
    .from('range_pending_legs')
    .update({ status: 'cancelled', error_message: reason, cancellation_status: 'cancelled', cancellation_confirmed_at: now })
    .eq('layer_plan_id', planId)
    .in('status', ['planned', 'pending', 'claimed'])
  const { data, error } = await supabase
    .from('layering_plans')
    .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('layer_plan_id', planId)
    .in('status', ['cancelling', 'cancellation_pending'])
    .select('layer_plan_id')
    .maybeSingle()
  if (error) return 'failed'
  return data ? 'cancelled' : 'not_ready'
}

export async function recoverCancellingLayeringPlans(
  supabase: SupabaseClient,
  opts?: { readonly apiLookup?: (uuid: string) => FxsocketBrokerClient | null },
): Promise<{ scanned: number; resolved: number; unresolved: number; failed: number }> {
  const { data, error } = await supabase
    .from('layering_plans')
    .select('layer_plan_id,cancellation_reason')
    .in('status', ['cancelling', 'cancellation_pending'])
    .limit(100)
  if (error || !data?.length) return { scanned: 0, resolved: 0, unresolved: 0, failed: 0 }
  let resolved = 0
  let unresolved = 0
  let failed = 0
  for (const plan of data as Array<{ layer_plan_id?: unknown; cancellation_reason?: unknown }>) {
    const planId = typeof plan.layer_plan_id === 'string' ? plan.layer_plan_id : null
    if (!planId) continue
    const outcome = await cancelLayeringPlan(
      supabase,
      planId,
      typeof plan.cancellation_reason === 'string' && plan.cancellation_reason ? plan.cancellation_reason : 'restart_cancellation_recovery',
      opts,
    )
    if (outcome === 'cancelled') resolved += 1
    else if (outcome === 'cancellation_pending' || outcome === 'cancellation_manual_review') unresolved += 1
    else if (outcome === 'failed' || outcome === 'invalid') failed += 1
  }
  return { scanned: data.length, resolved, unresolved, failed }
}
