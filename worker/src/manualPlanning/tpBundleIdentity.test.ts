import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  bundleSteadyLegTps,
  bundleTpOrderMap,
  remapBundleLegTpsByTpOrder,
  resolveBundleLegTpIndexes,
} from './tpBundleIdentity'

// Ladder ordered nearest → farthest as parsed (buy: ascending).
const buyLadder = [1900, 1910, 1920]
const sellLadder = [65200, 65000, 64900]

test('steady state keeps each leg own TP', () => {
  const tps = bundleSteadyLegTps({ currentTps: [1900, 1910, 1920], ladder: buyLadder })
  assert.deepEqual(tps, [1900, 1910, 1920])
})

test('steady state backfills naked legs positionally', () => {
  const tps = bundleSteadyLegTps({ currentTps: [0, null, undefined], ladder: buyLadder })
  assert.deepEqual(tps, [1900, 1910, 1920])
})

test('steady state backfills naked legs by planned :tpN index (not open order)', () => {
  // Migration BTC teaser: fills completed as tp3, tp1, tp2 by opened_at.
  const tps = bundleSteadyLegTps({
    currentTps: [0, 0, 0],
    ladder: sellLadder,
    legTpIndexes: [2, 0, 1],
  })
  assert.deepEqual(tps, [64900, 65200, 65000])
})

test('resolveBundleLegTpIndexes prefers comment over opened_at', () => {
  const indexes = resolveBundleLegTpIndexes({
    legs: [
      { lot_size: 1.0, comment: 'UniCopier:x:abc:tp3' },
      { lot_size: 2.5, comment: 'UniCopier:x:abc:tp1' },
      { lot_size: 1.5, comment: 'UniCopier:x:abc:tp2' },
    ],
    ladderLength: 3,
    tpLots: [
      { label: 'TP1', lot: 0, percent: 50, enabled: true },
      { label: 'TP2', lot: 0, percent: 30, enabled: true },
      { label: 'TP3', lot: 0, percent: 20, enabled: true },
    ],
  })
  assert.deepEqual(indexes, [2, 0, 1])
})

test('resolveBundleLegTpIndexes falls back to volume when comments missing', () => {
  const indexes = resolveBundleLegTpIndexes({
    legs: [
      { lot_size: 1.0 },
      { lot_size: 2.5 },
      { lot_size: 1.5 },
    ],
    ladderLength: 3,
    tpLots: [
      { label: 'TP1', lot: 0, percent: 50, enabled: true },
      { label: 'TP2', lot: 0, percent: 30, enabled: true },
      { label: 'TP3', lot: 0, percent: 20, enabled: true },
    ],
  })
  assert.deepEqual(indexes, [2, 0, 1])
})

test('resolveBundleLegTpIndexes ignores default next_tp_index=1 on every leg', () => {
  const indexes = resolveBundleLegTpIndexes({
    legs: [
      { lot_size: 1.0, next_tp_index: 1 },
      { lot_size: 2.5, next_tp_index: 1 },
      { lot_size: 1.5, next_tp_index: 1 },
    ],
    ladderLength: 3,
    tpLots: [
      { label: 'TP1', lot: 0, percent: 50, enabled: true },
      { label: 'TP2', lot: 0, percent: 30, enabled: true },
      { label: 'TP3', lot: 0, percent: 20, enabled: true },
    ],
  })
  assert.deepEqual(indexes, [2, 0, 1])
})

test('resolveBundleLegTpIndexes trusts distinct next_tp_index values', () => {
  const indexes = resolveBundleLegTpIndexes({
    legs: [
      { lot_size: 1.0, next_tp_index: 3 },
      { lot_size: 2.5, next_tp_index: 1 },
      { lot_size: 1.5, next_tp_index: 2 },
    ],
    ladderLength: 3,
  })
  assert.deepEqual(indexes, [2, 0, 1])
})

test('steady state keeps own TP when a middle level is missing', () => {
  // TP3 leg survives a closed TP2 leg — it must keep 1920, not be pulled to TP2.
  const tps = bundleSteadyLegTps({ currentTps: [1900, 0, 1920], ladder: buyLadder })
  assert.deepEqual(tps, [1900, 1910, 1920])
})

test('reladder maps levels 1:1 by TP order (buy ascending)', () => {
  const tps = remapBundleLegTpsByTpOrder({
    legs: [1900, 1910, 1920],
    ladder: [2000, 2010, 2020],
    isBuy: true,
  })
  assert.deepEqual(tps, [2000, 2010, 2020])
})

test('reladder keeps leg order independent of input order (buy)', () => {
  const tps = remapBundleLegTpsByTpOrder({
    legs: [1920, 1900, 1910],
    ladder: [2000, 2010, 2020],
    isBuy: true,
  })
  // 1900 was nearest → gets 2000, 1910 → 2010, 1920 → 2020.
  assert.deepEqual(tps, [2020, 2000, 2010])
})

test('reladder sell sorts nearest (highest price) first', () => {
  const tps = remapBundleLegTpsByTpOrder({
    legs: [1920, 1910, 1900],
    ladder: [1900, 1910, 1920],
    isBuy: false,
  })
  // nearest for sell = highest = 1920 → ladder[0]=1900; 1910 → 1910; 1900 → 1920.
  assert.deepEqual(tps, [1900, 1910, 1920])
})

test('reladder surplus legs keep their own TP', () => {
  const tps = remapBundleLegTpsByTpOrder({
    legs: [1900, 1910, 1920],
    ladder: [2000, 2010],
    isBuy: true,
  })
  assert.deepEqual(tps, [2000, 2010, 1920])
})

test('reladder with no ladder keeps own TPs', () => {
  const tps = remapBundleLegTpsByTpOrder({ legs: [1900, null, 1920], ladder: [], isBuy: true })
  assert.deepEqual(tps, [1900, 0, 1920])
})

test('bundleTpOrderMap maps by leg id', () => {
  const map = bundleTpOrderMap({
    legs: [
      { id: 'a', tp: 1900 },
      { id: 'b', tp: 1910 },
      { id: 'c', tp: 1920 },
    ],
    ladder: [2000, 2010, 2020],
    isBuy: true,
  })
  assert.equal(map.get('a'), 2000)
  assert.equal(map.get('b'), 2010)
  assert.equal(map.get('c'), 2020)
})
