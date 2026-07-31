import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  areLayeringPlansSemanticallyEqual,
  buildLayeringPlanSnapshot,
  computeLayeringPlanFingerprint,
  generateLayerPlanId,
  materializeLayerPlanLegRows,
  parsePersistedLayeringPlan,
  persistLayeringPlan,
  recoverLayeringPlan,
} from './layeringPlanPersistence'
import { calculateDynamicLayerPlan, calculateStaticLayerPlan, type CalculatedLayerPlanSuccess } from './layeringModeCalculators'
import { changeLayeringPlanMode, parseLayeringPlanSnapshot } from './layeringModes'

const CREATED_AT = '2026-07-31T00:00:00.000Z'

const identity = {
  signalId: '11111111-1111-4111-8111-111111111111',
  brokerAccountId: '22222222-2222-4222-8222-222222222222',
  basketKey: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:XAUUSD',
  symbol: 'XAUUSD',
  side: 'buy' as const,
  mode: 'static' as const,
}

function staticPlan(): CalculatedLayerPlanSuccess {
  const plan = calculateStaticLayerPlan({
    side: 'buy',
    rangeLow: 3340,
    rangeHigh: 3360,
    totalLayerCount: 5,
    symbolDigits: 2,
    intendedTotalLot: 0.1,
    minLot: 0.01,
    lotStep: 0.01,
  })
  assert.equal(plan.ok, true)
  return plan as CalculatedLayerPlanSuccess
}

function dynamicPlan(): CalculatedLayerPlanSuccess {
  const plan = calculateDynamicLayerPlan({
    side: 'sell',
    rangeLow: 3340,
    rangeHigh: 3360,
    firstFillPrice: 3344,
    stepPips: 4,
    maxTotalLayers: 5,
    pipSize: 1,
    symbolDigits: 2,
    intendedTotalLot: 0.13,
    minLot: 0.01,
    lotStep: 0.01,
  })
  assert.equal(plan.ok, true)
  return plan as CalculatedLayerPlanSuccess
}

function validSnapshot() {
  const planId = generateLayerPlanId(identity)
  assert.ok(planId)
  const built = buildLayeringPlanSnapshot({
    ...identity,
    planId,
    calculatedPlan: staticPlan(),
    anchorSource: 'signal',
    configuredStaticLayerCount: 5,
    createdAt: CREATED_AT,
  })
  assert.equal(built.ok, true)
  return built.snapshot
}

test('generateLayerPlanId is deterministic, safe, and identity-sensitive', () => {
  const first = generateLayerPlanId(identity)
  const again = generateLayerPlanId({ ...identity })
  assert.equal(first, again)
  assert.match(first!, /^layerplan_[A-Za-z0-9_-]+$/)
  assert.ok(first!.length >= 8 && first!.length <= 128)
  assert.notEqual(generateLayerPlanId({ ...identity, signalId: '33333333-3333-4333-8333-333333333333' }), first)
  assert.notEqual(generateLayerPlanId({ ...identity, brokerAccountId: '44444444-4444-4444-8444-444444444444' }), first)
  assert.notEqual(generateLayerPlanId({ ...identity, basketKey: 'other-basket' }), first)
  assert.notEqual(generateLayerPlanId({ ...identity, mode: 'dynamic' }), first)
  assert.doesNotMatch(first!, /11111111|22222222|XAUUSD/i)
  assert.equal(generateLayerPlanId({ ...identity, signalId: '11111111-1111-4111-8111-111111111111\nx' }), null)
  assert.equal(generateLayerPlanId({ ...identity, signalId: '' }), null)
  assert.equal(generateLayerPlanId({ ...identity, symbol: 'x'.repeat(257) }), null)
  assert.equal(generateLayerPlanId({ ...identity, basketKey: 'a=b\nmode=static' }), null)
  assert.equal(generateLayerPlanId({ ...identity, symbol: 'xauusd' }), first)
})

test('buildLayeringPlanSnapshot creates a locked static snapshot from funded prices only', () => {
  const snapshot = validSnapshot()
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.calculatorVersion, 'layering-v1')
  assert.equal(snapshot.mode, 'static')
  assert.equal(snapshot.lockedAt, CREATED_AT)
  assert.deepEqual(snapshot.fundedPrices, [3360, 3355, 3350, 3345, 3340])
  assert.deepEqual(snapshot.lots, [0.02, 0.02, 0.02, 0.02, 0.02])
  assert.equal(snapshot.plannedLayerCount, snapshot.fundedPrices!.length)
  assert.equal(snapshot.allocatedTotalLot! <= snapshot.plannedTotalLot!, true)
})

test('buildLayeringPlanSnapshot creates dynamic snapshot with raw and executable anchor', () => {
  const planId = generateLayerPlanId({ ...identity, mode: 'dynamic', side: 'sell' })
  assert.ok(planId)
  const built = buildLayeringPlanSnapshot({
    ...identity,
    mode: 'dynamic',
    side: 'sell',
    planId,
    calculatedPlan: dynamicPlan(),
    anchorSource: 'fill',
    configuredDynamicStepPips: 4,
    configuredDynamicMaxLayers: 5,
    createdAt: CREATED_AT,
  })
  assert.equal(built.ok, true)
  assert.equal(built.snapshot.anchorPrice, 3344)
  assert.equal(built.snapshot.executableAnchorPrice, 3344)
  assert.deepEqual(built.snapshot.fundedPrices, [3344, 3348, 3352, 3356, 3360])
})

test('snapshot builder rejects invalid and no-allocation calculator results', () => {
  const planId = generateLayerPlanId(identity)
  assert.ok(planId)
  const invalid = buildLayeringPlanSnapshot({
    ...identity,
    planId,
    calculatedPlan: { ok: false, mode: 'static', reason: 'invalid_range' } as never,
    anchorSource: 'signal',
    createdAt: CREATED_AT,
  })
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_calculated_plan' })
  const unfunded = calculateStaticLayerPlan({
    side: 'buy',
    rangeLow: 3340,
    rangeHigh: 3360,
    totalLayerCount: 5,
    symbolDigits: 2,
    intendedTotalLot: 0.001,
    minLot: 0.01,
    lotStep: 0.01,
  })
  assert.equal(unfunded.ok, false)
})

test('current setting mutation does not affect a locked snapshot', () => {
  const snapshot = validSnapshot()
  const mutableSettings = { static_layer_count: 10 }
  mutableSettings.static_layer_count = 2
  assert.equal(snapshot.configuredStaticLayerCount, 5)
  assert.throws(() => changeLayeringPlanMode(snapshot, 'dynamic'), /cannot change/)
})

test('parsePersistedLayeringPlan rejects unsupported versions and malformed metadata', () => {
  const snapshot = validSnapshot()
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, schemaVersion: 2 }).ok, false)
  assert.deepEqual(parsePersistedLayeringPlan({ ...snapshot, schemaVersion: 2 }), { ok: false, reason: 'unsupported_version' })
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, fundedPrices: [3360, 3360] }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, allocatedTotalLot: 0.09 }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, unallocatedLot: 0.02 }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, plannedTotalLot: 0.09 }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, lots: [0.02, 0.02, 0.02, 0.02, -0.02] }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, fundedPrices: [3360, 3355, 3350, 3345, 3339] }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, side: 'buy', fundedPrices: [3340, 3345, 3350, 3355, 3360] }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, plannedLayerCount: 4 }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, requestedLayerCount: 4 }).ok, false)
  assert.equal(parsePersistedLayeringPlan({ ...snapshot, plannedTotalLot: 0.1000000000001 }).ok, false)
  assert.equal(parsePersistedLayeringPlan(null).ok, false)
  assert.equal(parseLayeringPlanSnapshot(null)?.mode, 'legacy')
})

test('semantic fingerprints ignore lifecycle timestamps but detect immutable content changes', () => {
  const snapshot = validSnapshot()
  const retrySnapshot = { ...snapshot, createdAt: '2026-07-31T00:01:00.000Z', lockedAt: '2026-07-31T00:01:00.000Z' }
  assert.equal(areLayeringPlansSemanticallyEqual(snapshot, retrySnapshot), true)
  assert.equal(computeLayeringPlanFingerprint(snapshot), computeLayeringPlanFingerprint(retrySnapshot))
  assert.equal(areLayeringPlansSemanticallyEqual(snapshot, { ...snapshot, fundedPrices: [3360, 3355, 3350, 3345, 3341] }), false)
  assert.equal(areLayeringPlansSemanticallyEqual(snapshot, { ...snapshot, lots: [0.03, 0.02, 0.02, 0.02, 0.01] }), false)
  assert.equal(areLayeringPlansSemanticallyEqual(snapshot, { ...snapshot, configuredStaticLayerCount: 4 }), false)
})

class MockSupabase {
  rows = new Map<string, unknown>()
  failInsert = false

  from(table: string) {
    assert.equal(table, 'layering_plans')
    const rows = this.rows
    const shouldFailInsert = () => this.failInsert
    let selectedId = ''
    return {
      select() { return this },
      eq(_column: string, value: string) { selectedId = value; return this },
      async maybeSingle() {
        return { data: rows.get(selectedId) ?? null, error: null }
      },
      async insert(row: Record<string, unknown>) {
        if (shouldFailInsert()) return { error: { message: 'insert failed' } }
        const id = String(row.layer_plan_id)
        if (rows.has(id)) return { error: { code: '23505', message: 'duplicate key' } }
        rows.set(id, row)
        return { error: null }
      },
    }
  }
}

test('persistLayeringPlan creates, then returns matching existing without overwrite', async () => {
  const snapshot = validSnapshot()
  const db = new MockSupabase()
  const created = await persistLayeringPlan(db as never, snapshot)
  assert.equal(created.ok, true)
  assert.equal(created.ok && created.outcome, 'created')
  const again = await persistLayeringPlan(db as never, snapshot)
  assert.equal(again.ok, true)
  assert.equal(again.ok && again.outcome, 'already_exists_matching')
  assert.equal(db.rows.size, 1)
})

test('persistLayeringPlan treats retry timestamps as matching semantic plan content', async () => {
  const snapshot = validSnapshot()
  const db = new MockSupabase()
  assert.equal((await persistLayeringPlan(db as never, snapshot)).ok, true)
  const retrySnapshot = { ...snapshot, createdAt: '2026-07-31T00:02:00.000Z', lockedAt: '2026-07-31T00:02:00.000Z' }
  const again = await persistLayeringPlan(db as never, retrySnapshot)
  assert.equal(again.ok, true)
  assert.equal(again.ok && again.outcome, 'already_exists_matching')
  assert.equal(again.ok && again.snapshot.createdAt, snapshot.createdAt)
})

test('persistLayeringPlan handles simultaneous identical insert race and conflicting unique race', async () => {
  const snapshot = validSnapshot()
  const db = new MockSupabase()
  const [first, second] = await Promise.all([
    persistLayeringPlan(db as never, snapshot),
    persistLayeringPlan(db as never, { ...snapshot, createdAt: '2026-07-31T00:03:00.000Z', lockedAt: '2026-07-31T00:03:00.000Z' }),
  ])
  assert.deepEqual([first.ok, second.ok].sort(), [true, true])
  const conflict = await persistLayeringPlan(db as never, { ...snapshot, fundedPrices: [3360, 3355, 3350, 3345, 3341] })
  assert.deepEqual(conflict, { ok: false, reason: 'conflict' })
})

test('persistLayeringPlan detects same ID with different immutable metadata', async () => {
  const snapshot = validSnapshot()
  const db = new MockSupabase()
  db.rows.set(snapshot.planId, {
    layer_plan_id: snapshot.planId,
    signal_id: snapshot.signalId,
    broker_account_id: snapshot.brokerAccountId,
    basket_key: snapshot.basketKey ?? '',
    mode: snapshot.mode,
    status: 'prepared',
    layer_plan_metadata: { ...snapshot, lots: [0.03, 0.02, 0.02, 0.02, 0.01] },
    created_at: snapshot.createdAt,
    locked_at: snapshot.lockedAt,
  })
  const result = await persistLayeringPlan(db as never, snapshot)
  assert.deepEqual(result, { ok: false, reason: 'conflict' })
})

test('persistLayeringPlan returns stable failure without raw metadata', async () => {
  const snapshot = validSnapshot()
  const db = new MockSupabase()
  db.failInsert = true
  const result = await persistLayeringPlan(db as never, snapshot)
  assert.deepEqual(result, { ok: false, reason: 'persistence_failed' })
})

test('materializeLayerPlanLegRows uses funded prices only and stays non-executable', () => {
  const snapshot = validSnapshot()
  const rows = materializeLayerPlanLegRows(snapshot)
  assert.equal(rows.ok, true)
  assert.equal(rows.rows.length, snapshot.fundedPrices!.length)
  assert.deepEqual(rows.rows.map(r => r.trigger_price), snapshot.fundedPrices)
  assert.deepEqual(rows.rows.map(r => r.volume), snapshot.lots)
  assert.equal(rows.rows.every(r => r.layer_plan_id === snapshot.planId), true)
  assert.equal(rows.rows.every(r => r.status === 'planned'), true)
})

test('recoverLayeringPlan validates leg rows without calculator or settings lookup', () => {
  const snapshot = validSnapshot()
  const rows = materializeLayerPlanLegRows(snapshot)
  assert.equal(rows.ok, true)
  const planRow = {
    layer_plan_id: snapshot.planId,
    signal_id: snapshot.signalId,
    broker_account_id: snapshot.brokerAccountId,
    basket_key: snapshot.basketKey ?? '',
    mode: snapshot.mode,
    status: 'prepared' as const,
    layer_plan_metadata: snapshot,
    created_at: snapshot.createdAt,
    locked_at: snapshot.lockedAt!,
  }
  assert.equal(recoverLayeringPlan({ planRow, legRows: rows.rows }).ok, true)
  assert.equal(recoverLayeringPlan({ planRow: { ...planRow, status: 'active' }, legRows: rows.rows }).ok, true)
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, status: 'completed' } }), { ok: false, reason: 'terminal_plan' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, status: 'cancelled' } }), { ok: false, reason: 'terminal_plan' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, status: 'invalid' } }), { ok: false, reason: 'invalid_plan' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, status: 'mystery' as never } }), { ok: false, reason: 'unknown_status' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, signal_id: '33333333-3333-4333-8333-333333333333' } }), { ok: false, reason: 'identity_mismatch' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { ...planRow, created_at: '2026-07-31T00:10:00.000Z' } }), { ok: false, reason: 'identity_mismatch' })
  assert.deepEqual(recoverLayeringPlan({ planRow: null }), { ok: false, reason: 'not_found' })
  assert.deepEqual(recoverLayeringPlan({ planRow: { layer_plan_metadata: { ...snapshot, schemaVersion: 2 } } }), { ok: false, reason: 'unsupported_version' })
  assert.deepEqual(recoverLayeringPlan({ planRow, legRows: rows.rows.slice(1) }), {
    ok: false,
    reason: 'leg_count_mismatch',
  })
  assert.deepEqual(recoverLayeringPlan({ planRow, legRows: rows.rows.map((r, idx) => idx === 1 ? { ...r, step_idx: 1 } : r) }), {
    ok: false,
    reason: 'duplicate_leg',
  })
  assert.deepEqual(recoverLayeringPlan({ planRow, legRows: rows.rows.map((r, idx) => idx === 0 ? { ...r, trigger_price: 1 } : r) }), {
    ok: false,
    reason: 'price_mismatch',
  })
  assert.deepEqual(recoverLayeringPlan({ planRow, legRows: rows.rows.map((r, idx) => idx === 0 ? { ...r, volume: 0.03 } : r) }), {
    ok: false,
    reason: 'lot_mismatch',
  })
  assert.deepEqual(recoverLayeringPlan({ planRow, legRows: rows.rows.map((r, idx) => idx === 0 ? { ...r, status: 'pending' as never } : r) }), {
    ok: false,
    reason: 'identity_mismatch',
  })
})

test('Phase C migration creates non-executable prepared plan table only', () => {
  const sql = readFileSync('../supabase/migrations/20260731120000_layering_plans.sql', 'utf8')
  assert.match(sql, /create table if not exists public\.layering_plans/i)
  assert.match(sql, /status text not null default 'prepared'/i)
  assert.match(sql, /check \(status in \('prepared', 'active', 'completed', 'cancelled', 'invalid'\)\)/i)
  assert.match(sql, /alter table public\.layering_plans enable row level security/i)
  assert.match(sql, /revoke all on table public\.layering_plans from anon, authenticated/i)
  assert.match(sql, /grant select, insert, update, delete on table public\.layering_plans to service_role/i)
  assert.doesNotMatch(sql, /to authenticated/i)
  assert.doesNotMatch(sql, /to anon/i)
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i)
  assert.doesNotMatch(sql, /insert into public\.range_pending_legs|update public\.range_pending_legs|delete from public\.range_pending_legs/i)
})
