import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeSingleTpLotBreakdown, computeSingleTpPartialShortfall } from './singleTpLotBreakdown.ts'

const DEFAULT_ROWS = [
  { label: 'TP1', percent: 50, enabled: true },
  { label: 'TP2', percent: 30, enabled: true },
  { label: 'TP3', percent: 20, enabled: true },
]

test('50/30/20 on 0.5 lot → open 0.25 / 0.15 / 0.10', () => {
  const slices = computeSingleTpLotBreakdown({
    manualLot: 0.5,
    tpLots: DEFAULT_ROWS,
  })
  assert.deepEqual(
    slices.map(s => ({ tp: s.tpLabel, lots: s.lots })),
    [
      { tp: 'TP1', lots: 0.25 },
      { tp: 'TP2', lots: 0.15 },
      { tp: 'TP3', lots: 0.1 },
    ],
  )
})

test('50/30/20 on 1.0 lot → open 0.50 / 0.30 / 0.20', () => {
  const slices = computeSingleTpLotBreakdown({
    manualLot: 1,
    tpLots: DEFAULT_ROWS,
  })
  assert.deepEqual(
    slices.map(s => ({ tp: s.tpLabel, lots: s.lots })),
    [
      { tp: 'TP1', lots: 0.5 },
      { tp: 'TP2', lots: 0.3 },
      { tp: 'TP3', lots: 0.2 },
    ],
  )
})

test('50/30/20 on 3.0 lot → open 1.5 / 0.9 / 0.6', () => {
  const slices = computeSingleTpLotBreakdown({
    manualLot: 3,
    tpLots: DEFAULT_ROWS,
  })
  assert.deepEqual(
    slices.map(s => ({ tp: s.tpLabel, lots: s.lots })),
    [
      { tp: 'TP1', lots: 1.5 },
      { tp: 'TP2', lots: 0.9 },
      { tp: 'TP3', lots: 0.6 },
    ],
  )
})

test('singleTpTarget is ignored — still splits all enabled TPs', () => {
  const slices = computeSingleTpLotBreakdown({
    manualLot: 0.5,
    singleTpTarget: 'tp1',
    tpLots: DEFAULT_ROWS,
  })
  assert.deepEqual(
    slices.map(s => ({ tp: s.tpLabel, lots: s.lots })),
    [
      { tp: 'TP1', lots: 0.25 },
      { tp: 'TP2', lots: 0.15 },
      { tp: 'TP3', lots: 0.1 },
    ],
  )
})

test('one enabled TP → one full-lot trade', () => {
  const slices = computeSingleTpLotBreakdown({
    manualLot: 0.5,
    tpLots: [{ label: 'TP1', percent: 100, enabled: true }],
  })
  assert.deepEqual(slices, [{ tpLabel: 'TP1', tpIdx: 1, lots: 0.5 }])
})

test('invalid lot returns empty', () => {
  assert.deepEqual(
    computeSingleTpLotBreakdown({ manualLot: 0, tpLots: DEFAULT_ROWS }),
    [],
  )
})

test('shortfall: 0.01 lot cannot open 50/30/20 as separate trades', () => {
  const out = computeSingleTpPartialShortfall({
    manualLot: 0.01,
    tpLots: DEFAULT_ROWS,
  })
  assert.ok(out)
  assert.deepEqual(out!.dropped, ['TP2', 'TP3'])
})

test('shortfall: 0.08 lot opens every level', () => {
  const out = computeSingleTpPartialShortfall({
    manualLot: 0.08,
    tpLots: DEFAULT_ROWS,
  })
  assert.equal(out, null)
})

test('shortfall: single enabled row never warns', () => {
  const out = computeSingleTpPartialShortfall({
    manualLot: 0.01,
    tpLots: [{ label: 'TP1', percent: 100, enabled: true }],
  })
  assert.equal(out, null)
})

test('shortfall: 0.02 lot keeps only TP1 as one trade, drops TP2+TP3', () => {
  const out = computeSingleTpPartialShortfall({
    manualLot: 0.02,
    tpLots: DEFAULT_ROWS,
  })
  assert.ok(out)
  assert.deepEqual(out!.dropped, ['TP2', 'TP3'])
})
