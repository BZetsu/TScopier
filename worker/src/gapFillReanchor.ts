import type { SupabaseClient } from '@supabase/supabase-js'

/** Derive one-step price offset from a materialized range leg row. */
export function deriveStepPriceOffset(args: {
  stepIdx: number
  triggerPrice: number
  anchorPrice: number | null
  isBuy: boolean
}): number | null {
  const { stepIdx, triggerPrice, anchorPrice, isBuy } = args
  if (stepIdx <= 0 || !Number.isFinite(triggerPrice) || triggerPrice <= 0) return null
  if (anchorPrice == null || !Number.isFinite(anchorPrice) || anchorPrice <= 0) return null
  const span = isBuy ? anchorPrice - triggerPrice : triggerPrice - anchorPrice
  if (!Number.isFinite(span) || span <= 0) return null
  const offset = span / stepIdx
  if (!Number.isFinite(offset) || offset <= 0) return null
  return Number(offset.toFixed(8))
}

/** True when a market fill landed materially beyond the rung in the adverse direction. */
export function isGapFill(args: {
  isBuy: boolean
  triggerPrice: number
  fillPrice: number
  tolerance: number
}): boolean {
  const { isBuy, triggerPrice, fillPrice, tolerance } = args
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return false
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return false
  const tol = Math.max(0, tolerance)
  return isBuy ? fillPrice < triggerPrice - tol : fillPrice > triggerPrice + tol
}

/** Recompute trigger prices for pending rungs after a gap fill anchor. */
export function computeReanchorTriggers(args: {
  isBuy: boolean
  fillPrice: number
  stepPriceOffset: number
  firedStepIdx: number
  pendingStepIndices: number[]
  digits: number
}): Map<number, number> {
  const { isBuy, fillPrice, stepPriceOffset, firedStepIdx, pendingStepIndices, digits } = args
  const map = new Map<number, number>()
  const offset = Math.max(0, stepPriceOffset)
  const d = Math.max(0, Math.min(8, Math.floor(digits)))
  if (offset <= 0 || pendingStepIndices.length === 0) return map

  const sorted = [...pendingStepIndices].sort((a, b) => a - b)
  for (const stepIdx of sorted) {
    const rungsFromFill = stepIdx - firedStepIdx
    if (rungsFromFill <= 0) continue
    const raw = isBuy
      ? fillPrice - rungsFromFill * offset
      : fillPrice + rungsFromFill * offset
    map.set(stepIdx, Number(raw.toFixed(d)))
  }
  return map
}

export async function reanchorPendingLegsAfterGapFill(args: {
  supabase: SupabaseClient
  signalId: string
  brokerAccountId: string
  firedLegId: string
  firedStepIdx: number
  isBuy: boolean
  triggerPrice: number
  anchorPrice: number | null
  fillPrice: number
  slippagePoints: number
  point: number | null
  digits: number
}): Promise<{ updated: number; skipped: number }> {
  const {
    supabase,
    signalId,
    brokerAccountId,
    firedLegId,
    firedStepIdx,
    isBuy,
    triggerPrice,
    anchorPrice,
    fillPrice,
    slippagePoints,
    point,
    digits,
  } = args

  const tol = point != null && point > 0
    ? Math.max(2, Math.max(0, slippagePoints)) * point
    : 0
  if (!isGapFill({ isBuy, triggerPrice, fillPrice, tolerance: tol })) {
    return { updated: 0, skipped: 0 }
  }

  const stepOffset = deriveStepPriceOffset({
    stepIdx: firedStepIdx,
    triggerPrice,
    anchorPrice,
    isBuy,
  })
  if (stepOffset == null) return { updated: 0, skipped: 0 }

  const { data: pendingRows, error } = await supabase
    .from('range_pending_legs')
    .select('id, step_idx, trigger_price, status')
    .eq('signal_id', signalId)
    .eq('broker_account_id', brokerAccountId)
    .eq('status', 'pending')
    .neq('id', firedLegId)
  if (error || !pendingRows?.length) return { updated: 0, skipped: 0 }

  const obsolete = pendingRows.filter(row => {
    const tp = Number(row.trigger_price)
    if (!Number.isFinite(tp)) return false
    return isBuy ? tp > fillPrice + tol : tp < fillPrice - tol
  })
  if (!obsolete.length) return { updated: 0, skipped: pendingRows.length }

  const triggerMap = computeReanchorTriggers({
    isBuy,
    fillPrice,
    stepPriceOffset: stepOffset,
    firedStepIdx,
    pendingStepIndices: obsolete.map(r => Number(r.step_idx)),
    digits,
  })
  if (triggerMap.size === 0) return { updated: 0, skipped: obsolete.length }

  let updated = 0
  for (const row of obsolete) {
    const stepIdx = Number(row.step_idx)
    const nextTrigger = triggerMap.get(stepIdx)
    if (nextTrigger == null) continue
    const { error: updErr } = await supabase
      .from('range_pending_legs')
      .update({
        trigger_price: nextTrigger,
        anchor_price: fillPrice,
        error_message: null,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
    if (!updErr) updated += 1
  }
  return { updated, skipped: obsolete.length - updated }
}
