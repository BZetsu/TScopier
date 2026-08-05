import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  cancelLayeringPlan,
  convergeLayeringPlanAfterLegTerminal,
  markLayeringPlanInvalid,
} from './layeringPlanLifecycle'

type Row = Record<string, unknown>

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private inFilters: Array<{ key: string; values: unknown[] }> = []
  private isFilters: Array<{ key: string; value: unknown }> = []
  private patch: Row | null = null
  private selected = false

  constructor(private readonly rows: Row[]) {}

  select() { this.selected = true; return this }
  limit() { return this }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
  in(key: string, values: unknown[]) { this.inFilters.push({ key, values }); return this }
  is(key: string, value: unknown) { this.isFilters.push({ key, value }); return this }
  update(patch: Row) { this.patch = patch; return this }

  async maybeSingle() {
    const rows = this.filtered()
    if (this.patch) {
      const row = rows[0]
      if (!row) return { data: null, error: null }
      Object.assign(row, this.patch)
      return { data: this.selected ? { ...row } : null, error: null }
    }
    return { data: rows[0] ? { ...rows[0] } : null, error: null }
  }

  then(resolve: (value: { data: Row[]; error: null }) => void) {
    if (this.patch) this.filtered().forEach(row => Object.assign(row, this.patch))
    resolve({ data: this.filtered().map(row => ({ ...row })), error: null })
  }

  private filtered() {
    return this.rows.filter(row => (
      this.filters.every(fn => fn(row))
      && this.inFilters.every(f => f.values.includes(row[f.key]))
      && this.isFilters.every(f => f.value === null ? row[f.key] == null : row[f.key] === f.value)
    ))
  }
}

function plan(extra: Row = {}): Row {
  return {
    layer_plan_id: 'plan-1',
    status: 'active',
    layer_plan_metadata: { fundedPrices: [100, 99], lots: [0.01, 0.02] },
    first_execution_order_id: '7001',
    first_execution_status: 'confirmed',
    first_execution_fill_price: 100,
    first_execution_filled_lot: 0.01,
    first_execution_confirmed_at: '2026-07-31T00:00:00.000Z',
    ...extra,
  }
}

function db(planStatus: string, legs: Row[], planPatch: Row = {}) {
  const plans: Row[] = [plan({ status: planStatus, ...planPatch })]
  return {
    plans,
    legs,
    from(table: string) {
      return new Query(table === 'layering_plans' ? plans : legs)
    },
  }
}

test('first execution only completes one-layer plan idempotently', async () => {
  const supabase = db('active', [], {
    layer_plan_metadata: { fundedPrices: [100], lots: [0.01] },
  })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
  assert.equal(supabase.plans[0]!.status, 'completed')
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
})

test('pending legs only cannot complete without first execution linkage', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'fired' },
  ], { first_execution_order_id: null })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'not_ready')
  assert.equal(supabase.plans[0]!.status, 'active')
})

test('mixed virtual and native terminal legs complete when first execution is confirmed', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'fired' },
    { id: '2', layer_plan_id: 'plan-1', step_idx: 3, status: 'filled', native_submission_status: 'confirmed' },
  ], {
    layer_plan_metadata: { fundedPrices: [100, 99, 98], lots: [0.01, 0.02, 0.03] },
  })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
  assert.equal(supabase.plans[0]!.status, 'completed')
})

test('cancelled funded legs count as terminal completion', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'cancelled' },
  ])
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
})

test('first execution unconfirmed does not complete', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'fired' },
  ], { first_execution_status: 'pending' })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'not_ready')
})

test('partial first fill does not complete', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'fired' },
  ], { first_execution_filled_lot: 0.005 })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'not_ready')
  assert.equal(supabase.plans[0]!.status, 'active')
})

test('native open or ambiguous orders prevent completion', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'broker_pending', native_submission_status: 'confirmed' },
  ])
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'not_ready')
  supabase.legs[0]!.status = 'failed'
  supabase.legs[0]!.native_submission_status = 'reconciliation_required'
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'not_ready')
})

test('missing or duplicate funded legs cannot complete', async () => {
  const missing = db('active', [], {
    layer_plan_metadata: { fundedPrices: [100, 99], lots: [0.01, 0.02] },
  })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(missing as never, 'plan-1'), 'not_ready')
  const duplicate = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'fired' },
    { id: '2', layer_plan_id: 'plan-1', step_idx: 2, status: 'cancelled' },
  ], {
    layer_plan_metadata: { fundedPrices: [100, 99, 98], lots: [0.01, 0.02, 0.03] },
  })
  assert.equal(await convergeLayeringPlanAfterLegTerminal(duplicate as never, 'plan-1'), 'not_ready')
})

test('restart convergence completes active plan with all intended executions terminal', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', step_idx: 2, status: 'filled', native_submission_status: 'confirmed' },
  ])
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'completed')
})

test('cancellation stops future claims and preserves terminal history', async () => {
  const cancels: number[] = []
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', status: 'fired', ticket: '11' },
    { id: '2', layer_plan_id: 'plan-1', status: 'pending' },
    { id: '3', layer_plan_id: 'plan-1', status: 'broker_pending', ticket: '12', metaapi_account_id: 'mt-1', cancellation_requested_at: null },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel', {
    apiLookup: () => ({
      async openedOrders() {
        return [{ ticket: 12, operation: 'BuyLimit' }]
      },
      async orderClose(_uuid: string, args: { ticket: number }) {
        cancels.push(args.ticket)
        return { ticket: args.ticket }
      },
    } as never),
  }), 'cancelled')
  assert.equal(supabase.plans[0]!.status, 'cancelled')
  assert.equal(supabase.legs[0]!.status, 'fired')
  assert.equal(supabase.legs[1]!.status, 'cancelled')
  assert.equal(supabase.legs[2]!.status, 'cancelled')
  assert.deepEqual(cancels, [12])
})

test('native cancellation timeout remains pending and does not claim cancelled', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', status: 'broker_pending', ticket: '12', metaapi_account_id: 'mt-1', cancellation_requested_at: null },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel', {
    apiLookup: () => ({
      async openedOrders() {
        return [{ ticket: 12, operation: 'BuyLimit' }]
      },
      async orderClose() {
        throw new Error('OrderClose timed out')
      },
    } as never),
  }), 'cancellation_pending')
  assert.equal(supabase.plans[0]!.status, 'cancellation_pending')
  assert.equal(supabase.legs[0]!.status, 'broker_pending')
  assert.equal(supabase.legs[0]!.cancellation_status, 'cancellation_pending')
})

test('already filled native order is preserved without broker cancel', async () => {
  const cancels: number[] = []
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', status: 'broker_pending', ticket: '12', metaapi_account_id: 'mt-1', cancellation_requested_at: null },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel', {
    apiLookup: () => ({
      async openedOrders() {
        return [{ ticket: 12, operation: 'Buy' }]
      },
      async orderClose(_uuid: string, args: { ticket: number }) {
        cancels.push(args.ticket)
        return { ticket: args.ticket }
      },
    } as never),
  }), 'cancelled')
  assert.equal(supabase.legs[0]!.status, 'filled')
  assert.deepEqual(cancels, [])
})

test('already cancelled native order is adopted without broker cancel', async () => {
  const cancels: number[] = []
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', status: 'broker_pending', ticket: '12', metaapi_account_id: 'mt-1', cancellation_requested_at: null },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel', {
    apiLookup: () => ({
      async openedOrders() {
        return []
      },
      async closedOrders() {
        return [{ ticket: 12, state: 'cancelled' }]
      },
      async orderClose(_uuid: string, args: { ticket: number }) {
        cancels.push(args.ticket)
        return { ticket: args.ticket }
      },
    } as never),
  }), 'cancelled')
  assert.equal(supabase.legs[0]!.status, 'cancelled')
  assert.deepEqual(cancels, [])
})

test('duplicate cancellation request reconciles without a second broker cancel', async () => {
  const cancels: number[] = []
  const supabase = db('cancellation_pending', [
    {
      id: '1',
      layer_plan_id: 'plan-1',
      status: 'broker_pending',
      ticket: '12',
      metaapi_account_id: 'mt-1',
      cancellation_status: 'cancellation_pending',
      cancellation_requested_at: '2026-07-31T00:00:00.000Z',
    },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel', {
    apiLookup: () => ({
      async openedOrders() {
        return [{ ticket: 12, operation: 'BuyLimit' }]
      },
      async orderClose(_uuid: string, args: { ticket: number }) {
        cancels.push(args.ticket)
        return { ticket: args.ticket }
      },
    } as never),
  }), 'cancellation_pending')
  assert.deepEqual(cancels, [])
})

test('restart cancellation recovery adopts broker cancellation after timeout', async () => {
  const { recoverCancellingLayeringPlans } = await import('./layeringPlanLifecycle')
  const supabase = db('cancellation_pending', [
    {
      id: '1',
      layer_plan_id: 'plan-1',
      status: 'broker_pending',
      ticket: '12',
      metaapi_account_id: 'mt-1',
      cancellation_status: 'cancellation_pending',
      cancellation_requested_at: '2026-07-31T00:00:00.000Z',
    },
  ], { cancellation_reason: 'manual_cancel' })
  const result = await recoverCancellingLayeringPlans(supabase as never, {
    apiLookup: () => ({
      async openedOrders() {
        return []
      },
      async closedOrders() {
        return [{ ticket: 12, state: 'cancelled' }]
      },
      async orderClose() {
        throw new Error('must not cancel twice')
      },
    } as never),
  })
  assert.deepEqual(result, { scanned: 1, resolved: 1, unresolved: 0, failed: 0 })
  assert.equal(supabase.plans[0]!.status, 'cancelled')
  assert.equal(supabase.legs[0]!.status, 'cancelled')
})

test('missing native cancel capability becomes manual review', async () => {
  const supabase = db('active', [
    { id: '1', layer_plan_id: 'plan-1', status: 'broker_pending', ticket: '12', metaapi_account_id: 'mt-1' },
  ])
  assert.equal(await cancelLayeringPlan(supabase as never, 'plan-1', 'manual_cancel'), 'cancellation_manual_review')
  assert.equal(supabase.plans[0]!.status, 'cancellation_manual_review')
})

test('invalid plans cannot later complete', async () => {
  const supabase = db('active', [{ id: '1', layer_plan_id: 'plan-1', status: 'fired' }])
  assert.equal(await markLayeringPlanInvalid(supabase as never, 'plan-1', 'mismatch'), true)
  assert.equal(supabase.plans[0]!.status, 'invalid')
  assert.equal(await convergeLayeringPlanAfterLegTerminal(supabase as never, 'plan-1'), 'invalid')
})
