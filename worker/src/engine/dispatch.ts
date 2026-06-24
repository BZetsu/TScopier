/**
 * Dispatch router (Phase 5) - the thin v2 entry point that classifies a parsed signal
 * and routes it to the tested engine modules:
 *
 *   ENTRY  (buy/sell/re_enter)  -> plan (reused planner) -> ExecutionEngine.openBasket
 *                                  (+ seed virtual ladder for range/layering legs)
 *   MGMT   (modify/breakeven)   -> update desired-state ONLY; the reconciler applies it.
 *                                  This is the core fix for the "management goes haywire"
 *                                  class of bugs: management never races the broker, it
 *                                  just declares intent and one loop converges.
 *   CLOSE  (close)              -> mark desired-state closed; reconciler closes legs.
 *
 * Routing is a pure function (tested). The heavy I/O (planner, persistence, broker) is
 * provided as adapters so v2 can be parallel-run behind the executionMode flag before
 * v1 is retired.
 */
export type SignalKind = 'entry' | 'modify' | 'close' | 'breakeven' | 'partial' | 'ignore'

const ENTRY_ACTIONS = new Set(['buy', 'sell'])
const MGMT_MODIFY = new Set(['modify'])
const MGMT_CLOSE = new Set(['close'])
const MGMT_BREAKEVEN = new Set(['breakeven'])
const MGMT_PARTIAL = new Set(['partial_profit', 'partial_breakeven', 'partial_close'])

/** Classify a parsed action into the v2 routing lane. */
export function classifySignal(action: string | null | undefined, reEnter?: boolean): SignalKind {
  const a = (action ?? '').trim().toLowerCase()
  if (reEnter && ENTRY_ACTIONS.has(a)) return 'entry'
  if (ENTRY_ACTIONS.has(a)) return 'entry'
  if (MGMT_MODIFY.has(a)) return 'modify'
  if (MGMT_CLOSE.has(a)) return 'close'
  if (MGMT_BREAKEVEN.has(a)) return 'breakeven'
  if (MGMT_PARTIAL.has(a)) return 'partial'
  return 'ignore'
}

export function isEntry(kind: SignalKind): boolean {
  return kind === 'entry'
}

/** Management lanes update desired-state and let the reconciler converge - they never
 * call the broker directly, so they cannot half-apply, revert, or duplicate. */
export function isDesiredStateOnly(kind: SignalKind): boolean {
  return kind === 'modify' || kind === 'close' || kind === 'breakeven'
}
