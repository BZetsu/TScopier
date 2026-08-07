/**
 * Few-shot examples embedded in the stage-2 (OSS) and stage-3 (GPT-4o)
 * system prompts. Each example is a message + relevant context + the exact
 * JSON the model must return, teaching the failure modes seen in production:
 * invented prices, wrong-symbol modifications, target posts, results recaps,
 * pip units, and multi-trade ambiguity.
 */

export type FewShotExample = {
  title: string
  message: string
  contextLines?: string[]
  output: Record<string, unknown>
}

export function formatFewShots(examples: FewShotExample[]): string {
  return examples.map((ex, i) => [
    `--- Example ${i + 1}: ${ex.title} ---`,
    `Message: ${ex.message}`,
    ...(ex.contextLines && ex.contextLines.length > 0
      ? [`Context: ${ex.contextLines.join(' | ')}`]
      : []),
    `Output: ${JSON.stringify(ex.output)}`,
  ].join('\n')).join('\n\n')
}

function intent(
  kind: string,
  side: string | null,
  symbol: string | null,
  entry: number[],
  sl: number | null,
  tp: number[],
  flags: Record<string, unknown>,
  confidence: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind,
    side,
    symbol,
    entry,
    sl,
    tp,
    sl_unit: 'price',
    tp_unit: 'price',
    flags,
    confidence,
    detected_language: 'en',
    ...overrides,
  }
}

const emptyFlags = {
  market_now: false,
  re_enter: false,
  open_tp: false,
  partial_close_fraction: null,
}

/** Stage 2 — GPT OSS (Cerebras): context interpretation. */
export const STAGE_TWO_FEW_SHOTS: FewShotExample[] = [
  {
    title: 'direct buy entry with all values',
    message: 'GOLD BUY NOW\nEntry 2650\nSL 2640\nTP 2660',
    output: intent('entry', 'BUY', 'XAUUSD', [2650], 2640, [2660], {
      ...emptyFlags,
      market_now: true,
    }, 0.97),
  },
  {
    title: 'target post — never invent SL/TP',
    message: '🥇 #XAUUSD | 4276.00 To 4256.00\n\n💸 That\u2019s 2000$ Per Lot \u2714\ufe0f',
    contextLines: ['No parent reply. No open_trades provided.'],
    output: intent('commentary', null, 'XAUUSD', [], null, [], emptyFlags, 0.9),
  },
  {
    title: 'TP in pips, symbol from parent reply',
    message: 'You can add a Take Profit of 30 pips',
    contextLines: [
      'is_reply: true',
      'parent_signal: SELL XAUUSD entry 4300 sl 4280',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"}]',
    ],
    output: intent('modify', 'SELL', 'XAUUSD', [], null, [30], emptyFlags, 0.88, {
      tp_unit: 'pips',
    }),
  },
  {
    title: 'SL modification with explicit price',
    message: 'Move the Stop loss to 4280',
    contextLines: [
      'is_reply: true',
      'parent_signal: SELL XAUUSD entry 4300 sl 4300',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"}]',
    ],
    output: intent('modify', 'SELL', 'XAUUSD', [], 4280, [], emptyFlags, 0.92),
  },
  {
    title: 'results recap is not a new trade',
    message: '\U0001f3c6 SELL HITS TP1 +20 PIPS \u2705',
    output: intent('commentary', null, 'XAUUSD', [], null, [], emptyFlags, 0.85),
  },
  {
    title: 'analysis with suggested SL is commentary',
    message: 'GOLD is looking weak. SL suggested around 4273 for any shorts.',
    output: intent('commentary', null, 'XAUUSD', [], null, [], emptyFlags, 0.82),
  },
  {
    title: 'ambiguous target with several open trades',
    message: 'Move the SL to breakeven',
    contextLines: [
      'is_reply: false',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"},{"symbol":"EURUSD","direction":"BUY"}]',
    ],
    output: intent('uncertain', null, null, [], null, [], emptyFlags, 0.5),
  },
  {
    title: 'partial close on the replied trade',
    message: 'Close half of the gold trade now',
    contextLines: [
      'is_reply: true',
      'parent_signal: SELL XAUUSD entry 4300',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"}]',
    ],
    output: intent('partial_close', 'SELL', 'XAUUSD', [], null, [], {
      ...emptyFlags,
      partial_close_fraction: 0.5,
    }, 0.9),
  },
  {
    title: 'multilingual entry zone (Portuguese)',
    message: '📊 VAMOS FAZER UM SCALPING\n💵 Moeda: XAU-USD\n🖐 Análise: Venda (Sell)\n🎯 Entrada: 4060\n⛔ Stop Loss (SL): 4080\n\nTake Profit:\n✅ TP 4055\n✅ TP 4050\n✅ TP 4040',
    output: intent('entry', 'SELL', 'XAUUSD', [4060], 4080, [4055, 4050, 4040], emptyFlags, 0.96, {
      detected_language: 'pt',
    }),
  },
  {
    title: 'cancel a pending order',
    message: 'Delete the buy limit at 2650',
    contextLines: ['is_reply: true', 'parent_signal: BUY XAUUSD entry 2650 (pending)'],
    output: intent('cancel_pending', 'BUY', 'XAUUSD', [2650], null, [], emptyFlags, 0.87),
  },
]

/** Stage 3 — GPT-4o: final reconciliation. */
export const STAGE_THREE_FEW_SHOTS: FewShotExample[] = [
  {
    title: 'stage 2 invented prices — reclassify, do not execute',
    message: '🥇 #XAUUSD | 4276.00 To 4256.00\n\n💸 That\u2019s 2000$ Per Lot \u2714\ufe0f',
    contextLines: [
      'stage1_deterministic: {action: ignore, confidence: 0}',
      'stage2_llm_intent: {kind: entry, side: SELL, symbol: XAUUSD, sl: 4281, tp: [4271, 4266, 4155]}',
      'stage2_reason: intent_validation_failed:invented_sl',
      'open_trades: []',
    ],
    output: intent('commentary', null, 'XAUUSD', [], null, [], emptyFlags, 0.9),
  },
  {
    title: 'reply contradicts stage 2 — parent symbol wins',
    message: 'You can add a Take Profit of 30 pips',
    contextLines: [
      'is_reply: true',
      'parent_signal: SELL XAUUSD entry 4300 sl 4280',
      'stage1_deterministic: {action: ignore, confidence: 0}',
      'stage2_llm_intent: {kind: modify, side: null, symbol: EURUSD, tp: [30], tp_unit: pips}',
      'stage2_reason: modification_parent_symbol_conflict:EURUSD',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"},{"symbol":"EURUSD","direction":"BUY"}]',
    ],
    output: intent('modify', 'SELL', 'XAUUSD', [], null, [30], emptyFlags, 0.92, {
      tp_unit: 'pips',
    }),
  },
  {
    title: 'results recap — stage 2 wrongly recovered a trade',
    message: '\U0001f3c6 SELL HITS TP1 +20 PIPS \u2705',
    contextLines: [
      'stage1_deterministic: {action: sell, symbol: XAUUSD, confidence: 0.93}',
      'stage2_llm_intent: {kind: entry, side: SELL, symbol: XAUUSD, tp: [20], tp_unit: pips}',
      'stage2_reason: null',
      'open_trades: []',
    ],
    output: intent('commentary', null, 'XAUUSD', [], null, [], emptyFlags, 0.88),
  },
  {
    title: 'genuine ambiguity — escalate to human',
    message: 'Move the SL to breakeven',
    contextLines: [
      'is_reply: false',
      'stage1_deterministic: {action: ignore, confidence: 0}',
      'stage2_llm_intent: {kind: uncertain}',
      'open_trades: [{"symbol":"XAUUSD","direction":"SELL"},{"symbol":"XAUUSD","direction":"BUY"}]',
    ],
    output: intent('uncertain', null, null, [], null, [], emptyFlags, 0.5),
  },
  {
    title: 'entry without side and no context — escalate',
    message: 'Gold entry 2650 SL 2640',
    contextLines: [
      'stage1_deterministic: {action: ignore, confidence: 0}',
      'stage2_llm_intent: {kind: entry, side: null, symbol: XAUUSD, entry: [2650], sl: 2640}',
      'stage2_reason: entry_missing_side',
      'open_trades: []',
    ],
    output: intent('uncertain', null, 'XAUUSD', [2650], 2640, [], emptyFlags, 0.45),
  },
  {
    title: 'real trade wrongly blocked by stage 2 — confirm and execute',
    message: 'GOLD SELL NOW @4258 SL:4273',
    contextLines: [
      'stage1_deterministic: {action: sell, symbol: XAUUSD, entry_price: 4258, sl: 4273, confidence: 0.93}',
      'stage2_llm_intent: {kind: commentary}',
      'stage2_reason: null',
      'open_trades: []',
    ],
    output: intent('entry', 'SELL', 'XAUUSD', [4258], 4273, [], {
      ...emptyFlags,
      market_now: true,
    }, 0.95),
  },
]
