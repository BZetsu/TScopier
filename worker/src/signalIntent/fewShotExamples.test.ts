import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFewShots,
  STAGE_TWO_FEW_SHOTS,
  STAGE_THREE_FEW_SHOTS,
  type FewShotExample,
} from './fewShotExamples'

function validIntentJson(output: unknown): void {
  const j = output as Record<string, unknown>
  assert.equal(typeof j.kind, 'string')
  assert.ok(
    ['entry', 'modify', 'close', 'breakeven', 'partial_close', 'cancel_pending', 'ignore', 'commentary', 'uncertain']
      .includes(String(j.kind)),
  )
  assert.ok(Array.isArray(j.entry))
  assert.ok(Array.isArray(j.tp))
  assert.equal(typeof j.confidence, 'number')
  assert.equal(typeof j.sl_unit, 'string')
  assert.equal(typeof j.tp_unit, 'string')
  assert.ok(j.flags && typeof j.flags === 'object')
}

function everyOutputValid(examples: FewShotExample[]): void {
  for (const ex of examples) validIntentJson(ex.output)
}

describe('fewShotExamples', () => {
  it('every stage-2 example output matches the TradeIntent schema', () => {
    everyOutputValid(STAGE_TWO_FEW_SHOTS)
  })

  it('every stage-3 example output matches the TradeIntent schema', () => {
    everyOutputValid(STAGE_THREE_FEW_SHOTS)
  })

  it('stage 2 teaches: invented SL/TP must not appear for the target post', () => {
    const targetPost = STAGE_TWO_FEW_SHOTS.find(ex => ex.title === 'target post — never invent SL/TP')
    assert.ok(targetPost)
    assert.equal(targetPost.output.kind, 'commentary')
    assert.equal(targetPost.output.sl, null)
    assert.deepEqual(targetPost.output.tp, [])
  })

  it('stage 2 teaches: pips stay pips (no conversion to absolute prices)', () => {
    const tpPips = STAGE_TWO_FEW_SHOTS.find(ex => ex.title === 'TP in pips, symbol from parent reply')
    assert.ok(tpPips)
    assert.equal(tpPips.output.tp_unit, 'pips')
    assert.deepEqual(tpPips.output.tp, [30])
    assert.equal(tpPips.output.symbol, 'XAUUSD')
  })

  it('stage 2 teaches: ambiguous multi-trade target → uncertain', () => {
    const ambiguous = STAGE_TWO_FEW_SHOTS.find(ex => ex.title === 'ambiguous target with several open trades')
    assert.ok(ambiguous)
    assert.equal(ambiguous.output.kind, 'uncertain')
  })

  it('stage 3 teaches: invented prices are rejected and reclassified', () => {
    const invented = STAGE_THREE_FEW_SHOTS.find(ex => ex.title === 'stage 2 invented prices — reclassify, do not execute')
    assert.ok(invented)
    assert.equal(invented.output.kind, 'commentary')
    assert.equal(invented.output.sl, null)
  })

  it('stage 3 teaches: parent symbol wins over stage-2 symbol', () => {
    const conflict = STAGE_THREE_FEW_SHOTS.find(ex => ex.title === 'reply contradicts stage 2 — parent symbol wins')
    assert.ok(conflict)
    assert.equal(conflict.output.symbol, 'XAUUSD')
    assert.equal(conflict.output.kind, 'modify')
  })

  it('stage 3 teaches: escalation to uncertain for genuine ambiguity', () => {
    const ambiguous = STAGE_THREE_FEW_SHOTS.find(ex => ex.title === 'genuine ambiguity — escalate to human')
    assert.ok(ambiguous)
    assert.equal(ambiguous.output.kind, 'uncertain')
  })

  it('stage 3 teaches: real trades wrongly blocked by stage 2 are confirmed', () => {
    const realTrade = STAGE_THREE_FEW_SHOTS.find(ex => ex.title === 'real trade wrongly blocked by stage 2 — confirm and execute')
    assert.ok(realTrade)
    assert.equal(realTrade.output.kind, 'entry')
    assert.equal(realTrade.output.side, 'SELL')
  })

  it('formatFewShots renders every example with Message, Context and Output lines', () => {
    const text = formatFewShots(STAGE_TWO_FEW_SHOTS)
    assert.equal(text.includes('--- Example 1:'), true)
    assert.equal(text.includes('--- Example 10:'), true)
    assert.equal(text.includes('Message:'), true)
    assert.equal(text.includes('Context:'), true)
    assert.equal(text.includes('Output:'), true)
  })
})
