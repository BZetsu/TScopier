import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptySignalExampleFormDraft,
  formDraftFromIntent,
  intentFromFormDraft,
  labelFromIntent,
  looksLikeNonTradableCommentary,
  type TradeIntent,
} from './tradeIntent'

describe('tradeIntent form helpers', () => {
  it('maps entry Buy draft to TradeIntent', () => {
    const draft = {
      ...emptySignalExampleFormDraft(),
      rawMessage: 'GOLD BUY NOW\nEntry 4505\nSL 4495\nTP 4520',
      signalType: 'entry' as const,
      side: 'BUY' as const,
      symbol: 'XAUUSD',
      entryPrice: '4505',
      sl: '4495',
      tpLevels: ['4520'],
    }
    const result = intentFromFormDraft(draft)
    assert.equal(result.error, null)
    assert.equal(result.label, 'entry')
    assert.equal(result.intent.kind, 'entry')
    assert.equal(result.intent.side, 'BUY')
    assert.equal(result.intent.symbol, 'XAUUSD')
    assert.deepEqual(result.intent.entry, [4505])
    assert.equal(result.intent.sl, 4495)
    assert.deepEqual(result.intent.tp, [4520])
  })

  it('rejects entry without side', () => {
    const draft = {
      ...emptySignalExampleFormDraft(),
      rawMessage: 'GOLD NOW\nEntry 4505',
      signalType: 'entry' as const,
      side: 'NONE' as const,
      entryPrice: '4505',
    }
    const result = intentFromFormDraft(draft)
    assert.equal(result.error, 'entry_missing_side')
  })

  it('maps trade update draft', () => {
    const draft = {
      ...emptySignalExampleFormDraft(),
      rawMessage: 'Move SL to 4500',
      signalType: 'update' as const,
      updateKind: 'modify' as const,
      symbol: 'XAUUSD',
      sl: '4500',
    }
    const result = intentFromFormDraft(draft)
    assert.equal(result.error, null)
    assert.equal(result.label, 'update')
    assert.equal(result.intent.kind, 'modify')
    assert.equal(result.intent.sl, 4500)
  })

  it('round-trips formDraftFromIntent', () => {
    const intent: TradeIntent = {
      kind: 'entry',
      side: 'SELL',
      symbol: 'XAUUSD',
      entry: [4040],
      sl: 4050,
      tp: [4030, 4020],
      sl_unit: 'price',
      tp_unit: 'price',
      flags: { re_enter: true },
      confidence: 0.9,
    }
    const draft = formDraftFromIntent('Venda XAU', 'entry', intent)
    assert.equal(draft.side, 'SELL')
    assert.equal(draft.entryPrice, '4040')
    assert.equal(draft.sl, '4050')
    assert.deepEqual(draft.tpLevels, ['4030', '4020'])
    assert.equal(labelFromIntent(intent), 'entry')
  })
})

describe('looksLikeNonTradableCommentary', () => {
  it('rejects past-tense celebration gold buy', () => {
    assert.equal(
      looksLikeNonTradableCommentary(
        'I am excited about the Gold buy we took earlier at 4505, such a banger!!!',
      ),
      true,
    )
  })

  it('allows structured new entry', () => {
    assert.equal(
      looksLikeNonTradableCommentary(`GOLD BUY NOW
Entry 4505
SL 4495
TP 4520`),
      false,
    )
  })
})
