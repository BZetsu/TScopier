import { MAX_LAYER_COUNT, MIN_LAYER_COUNT } from './layeringModes'
import { allocateLayerLots, type LayerLotAllocationReason } from './layerLotAllocation'

export type LayerPlanMode = 'static' | 'dynamic'
export type LayerPlanSide = 'buy' | 'sell'

export type LayerPlanReason =
  | 'invalid_range'
  | 'invalid_side'
  | 'invalid_layer_count'
  | 'invalid_step_pips'
  | 'invalid_pip_size'
  | 'invalid_symbol_digits'
  | 'invalid_anchor'
  | 'anchor_outside_range'
  | 'anchor_unrepresentable_at_precision'
  | 'insufficient_remaining_distance'
  | 'duplicate_price_after_rounding'
  | 'layer_count_reduced_by_precision'
  | 'no_valid_layers'
  | LayerLotAllocationReason

export interface SkippedLayer {
  readonly sourceIndex: number
  readonly rawPrice: number
  readonly normalizedPrice: number
  readonly reason: LayerPlanReason
}

export interface NormalizeLayerPricesInput {
  readonly candidateRawPrices: readonly number[]
  readonly rangeLow: number
  readonly rangeHigh: number
  readonly symbolDigits: number
}

export interface NormalizeLayerPricesSuccess {
  readonly ok: true
  readonly candidateRawPrices: readonly number[]
  readonly normalizedCandidatePrices: readonly number[]
  readonly duplicateLevelsRemoved: number
  readonly duplicateSourceIndexes: readonly number[]
  readonly skippedLevels: readonly SkippedLayer[]
  readonly reasons: readonly LayerPlanReason[]
}

export interface NormalizeLayerPricesFailure {
  readonly ok: false
  readonly reason: LayerPlanReason
}

export type NormalizeLayerPricesResult = NormalizeLayerPricesSuccess | NormalizeLayerPricesFailure

export interface StaticLayerPricePlanInput {
  readonly side: LayerPlanSide
  readonly rangeLow: number
  readonly rangeHigh: number
  readonly totalLayerCount: number
  readonly symbolDigits: number
}

export interface DynamicLayerPricePlanInput {
  readonly side: LayerPlanSide
  readonly rangeLow: number
  readonly rangeHigh: number
  readonly firstFillPrice: number
  readonly stepPips: number
  readonly maxTotalLayers: number
  readonly pipSize: number
  readonly symbolDigits: number
}

export interface LayerPricePlanSuccess {
  readonly ok: true
  readonly mode: LayerPlanMode
  readonly side: LayerPlanSide
  readonly rangeLow: number
  readonly rangeHigh: number
  readonly rawAnchorPrice: number | null
  readonly executableAnchorPrice: number | null
  readonly requestedLayerCount: number
  readonly actualLayerCount: number
  readonly candidateRawPrices: readonly number[]
  readonly normalizedCandidatePrices: readonly number[]
  readonly duplicateLevelsRemoved: number
  readonly skippedLevels: readonly SkippedLayer[]
  readonly reasons: readonly LayerPlanReason[]
}

export interface LayerPricePlanFailure {
  readonly ok: false
  readonly mode: LayerPlanMode
  readonly reason: LayerPlanReason
}

export type LayerPricePlanResult = LayerPricePlanSuccess | LayerPricePlanFailure

export interface CalculatedLayerPlanInput {
  readonly pricePlan: LayerPricePlanSuccess
  readonly intendedTotalLot: number
  readonly minLot: number
  readonly lotStep: number
}

export interface CalculatedLayerPlanSuccess extends LayerPricePlanSuccess {
  readonly ok: true
  readonly fundedPrices: readonly number[]
  readonly unfundedPrices: readonly number[]
  readonly unfundedIndexes: readonly number[]
  readonly lots: readonly number[]
  readonly intendedTotalLot: number
  readonly allocatedTotalLot: number
  readonly unallocatedLot: number
}

export type CalculatedLayerPlanResult = CalculatedLayerPlanSuccess | LayerPricePlanFailure

const PRICE_EPS = 1e-9

function isValidSide(side: unknown): side is LayerPlanSide {
  return side === 'buy' || side === 'sell'
}

function validRange(rangeLow: number, rangeHigh: number): boolean {
  return Number.isFinite(rangeLow) && Number.isFinite(rangeHigh) && rangeLow <= rangeHigh
}

function validDigits(symbolDigits: number): boolean {
  return Number.isInteger(symbolDigits) && symbolDigits >= 0 && symbolDigits <= 8
}

function roundPrice(price: number, symbolDigits: number): number {
  const rounded = Number(price.toFixed(symbolDigits))
  return Object.is(rounded, -0) ? 0 : rounded
}

function inRange(price: number, rangeLow: number, rangeHigh: number): boolean {
  return price >= rangeLow - PRICE_EPS && price <= rangeHigh + PRICE_EPS
}

function freezeSuccess<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

function uniqueReasons(reasons: readonly LayerPlanReason[]): readonly LayerPlanReason[] {
  return Object.freeze([...new Set(reasons)])
}

function validateLayerCount(layerCount: number): boolean {
  return Number.isInteger(layerCount) && layerCount >= MIN_LAYER_COUNT && layerCount <= MAX_LAYER_COUNT
}

export function normalizeLayerPrices(input: NormalizeLayerPricesInput): NormalizeLayerPricesResult {
  const { candidateRawPrices, rangeLow, rangeHigh, symbolDigits } = input
  if (!validRange(rangeLow, rangeHigh)) return { ok: false, reason: 'invalid_range' }
  if (!validDigits(symbolDigits)) return { ok: false, reason: 'invalid_symbol_digits' }

  const normalizedPrices: number[] = []
  const duplicateSourceIndexes: number[] = []
  const skippedLevels: SkippedLayer[] = []
  const seen = new Set<string>()

  for (let idx = 0; idx < candidateRawPrices.length; idx++) {
    const rawPrice = candidateRawPrices[idx]
    if (rawPrice == null || !Number.isFinite(rawPrice)) return { ok: false, reason: 'no_valid_layers' }
    const normalizedPrice = roundPrice(rawPrice, symbolDigits)
    if (!inRange(normalizedPrice, rangeLow, rangeHigh)) return { ok: false, reason: 'invalid_range' }
    const key = normalizedPrice.toFixed(symbolDigits)
    if (seen.has(key)) {
      duplicateSourceIndexes.push(idx)
      skippedLevels.push({
        sourceIndex: idx,
        rawPrice,
        normalizedPrice,
        reason: 'duplicate_price_after_rounding',
      })
      continue
    }
    seen.add(key)
    normalizedPrices.push(normalizedPrice)
  }

  if (normalizedPrices.length === 0) return { ok: false, reason: 'no_valid_layers' }

  const reasons: LayerPlanReason[] = []
  if (duplicateSourceIndexes.length > 0) {
    reasons.push('duplicate_price_after_rounding', 'layer_count_reduced_by_precision')
  }

  return freezeSuccess({
    ok: true,
    candidateRawPrices: Object.freeze([...candidateRawPrices]),
    normalizedCandidatePrices: Object.freeze(normalizedPrices),
    duplicateLevelsRemoved: duplicateSourceIndexes.length,
    duplicateSourceIndexes: Object.freeze(duplicateSourceIndexes),
    skippedLevels: Object.freeze(skippedLevels),
    reasons: Object.freeze(reasons),
  })
}

export function calculateStaticLayerPrices(input: StaticLayerPricePlanInput): LayerPricePlanResult {
  const { side, rangeLow, rangeHigh, totalLayerCount, symbolDigits } = input
  if (!isValidSide(side)) return { ok: false, mode: 'static', reason: 'invalid_side' }
  if (!validRange(rangeLow, rangeHigh)) return { ok: false, mode: 'static', reason: 'invalid_range' }
  if (!validDigits(symbolDigits)) return { ok: false, mode: 'static', reason: 'invalid_symbol_digits' }
  if (!validateLayerCount(totalLayerCount)) return { ok: false, mode: 'static', reason: 'invalid_layer_count' }
  if (rangeLow === rangeHigh && totalLayerCount > 1) return { ok: false, mode: 'static', reason: 'invalid_range' }

  const rawPrices = totalLayerCount === 1
    ? [side === 'buy' ? rangeHigh : rangeLow]
    : Array.from({ length: totalLayerCount }, (_, idx) => {
      const t = idx / (totalLayerCount - 1)
      return side === 'buy'
        ? rangeHigh - (rangeHigh - rangeLow) * t
        : rangeLow + (rangeHigh - rangeLow) * t
    })
  const normalized = normalizeLayerPrices({ candidateRawPrices: rawPrices, rangeLow, rangeHigh, symbolDigits })
  if (!normalized.ok) return { ok: false, mode: 'static', reason: normalized.reason }

  return freezeSuccess({
    ok: true,
    mode: 'static',
    side,
    rangeLow,
    rangeHigh,
    rawAnchorPrice: null,
    executableAnchorPrice: null,
    requestedLayerCount: totalLayerCount,
    actualLayerCount: normalized.normalizedCandidatePrices.length,
    candidateRawPrices: normalized.candidateRawPrices,
    normalizedCandidatePrices: normalized.normalizedCandidatePrices,
    duplicateLevelsRemoved: normalized.duplicateLevelsRemoved,
    skippedLevels: normalized.skippedLevels,
    reasons: uniqueReasons(normalized.reasons),
  })
}

export function calculateDynamicLayerPrices(input: DynamicLayerPricePlanInput): LayerPricePlanResult {
  const { side, rangeLow, rangeHigh, firstFillPrice, stepPips, maxTotalLayers, pipSize, symbolDigits } = input
  if (!isValidSide(side)) return { ok: false, mode: 'dynamic', reason: 'invalid_side' }
  if (!validRange(rangeLow, rangeHigh)) return { ok: false, mode: 'dynamic', reason: 'invalid_range' }
  if (!validDigits(symbolDigits)) return { ok: false, mode: 'dynamic', reason: 'invalid_symbol_digits' }
  if (!Number.isFinite(firstFillPrice)) return { ok: false, mode: 'dynamic', reason: 'invalid_anchor' }
  if (!Number.isFinite(stepPips) || stepPips <= 0) return { ok: false, mode: 'dynamic', reason: 'invalid_step_pips' }
  if (!Number.isFinite(pipSize) || pipSize <= 0) return { ok: false, mode: 'dynamic', reason: 'invalid_pip_size' }
  if (!validateLayerCount(maxTotalLayers)) return { ok: false, mode: 'dynamic', reason: 'invalid_layer_count' }

  const outsideRange = firstFillPrice < rangeLow || firstFillPrice > rangeHigh
  if (outsideRange || maxTotalLayers === 1) {
    const normalizedAnchor = normalizeLayerPrices({
      candidateRawPrices: [firstFillPrice],
      rangeLow,
      rangeHigh,
      symbolDigits,
    })
    if (!normalizedAnchor.ok) {
      return { ok: false, mode: 'dynamic', reason: 'anchor_unrepresentable_at_precision' }
    }
    const executableAnchorPrice = normalizedAnchor.normalizedCandidatePrices[0]!
    return freezeSuccess({
      ok: true,
      mode: 'dynamic',
      side,
      rangeLow,
      rangeHigh,
      rawAnchorPrice: firstFillPrice,
      executableAnchorPrice,
      requestedLayerCount: maxTotalLayers,
      actualLayerCount: 1,
      candidateRawPrices: normalizedAnchor.candidateRawPrices,
      normalizedCandidatePrices: normalizedAnchor.normalizedCandidatePrices,
      duplicateLevelsRemoved: 0,
      skippedLevels: Object.freeze([]),
      reasons: uniqueReasons(outsideRange ? ['anchor_outside_range'] : []),
    })
  }

  const stepPrice = stepPips * pipSize
  if (!Number.isFinite(stepPrice) || stepPrice <= 0) return { ok: false, mode: 'dynamic', reason: 'invalid_step_pips' }
  const farBoundary = side === 'buy' ? rangeLow : rangeHigh
  const remainingDistance = side === 'buy' ? firstFillPrice - farBoundary : farBoundary - firstFillPrice
  const rawPrices = [firstFillPrice]
  const reasons: LayerPlanReason[] = []

  if (remainingDistance + PRICE_EPS < stepPrice) {
    reasons.push('insufficient_remaining_distance')
  } else {
    for (let idx = 1; idx < maxTotalLayers; idx++) {
      const next = side === 'buy' ? firstFillPrice - idx * stepPrice : firstFillPrice + idx * stepPrice
      if (side === 'buy' && next < rangeLow - PRICE_EPS) break
      if (side === 'sell' && next > rangeHigh + PRICE_EPS) break
      rawPrices.push(next)
    }
  }

  const normalized = normalizeLayerPrices({ candidateRawPrices: rawPrices, rangeLow, rangeHigh, symbolDigits })
  if (!normalized.ok) {
    return { ok: false, mode: 'dynamic', reason: normalized.reason === 'invalid_range' ? 'anchor_unrepresentable_at_precision' : normalized.reason }
  }
  const executableAnchorPrice = normalized.normalizedCandidatePrices[0]!

  return freezeSuccess({
    ok: true,
    mode: 'dynamic',
    side,
    rangeLow,
    rangeHigh,
    rawAnchorPrice: firstFillPrice,
    executableAnchorPrice,
    requestedLayerCount: maxTotalLayers,
    actualLayerCount: normalized.normalizedCandidatePrices.length,
    candidateRawPrices: normalized.candidateRawPrices,
    normalizedCandidatePrices: normalized.normalizedCandidatePrices,
    duplicateLevelsRemoved: normalized.duplicateLevelsRemoved,
    skippedLevels: normalized.skippedLevels,
    reasons: uniqueReasons([...reasons, ...normalized.reasons]),
  })
}

export function buildCalculatedLayerPlan(input: CalculatedLayerPlanInput): CalculatedLayerPlanResult {
  const allocation = allocateLayerLots({
    intendedTotalLot: input.intendedTotalLot,
    layerCount: input.pricePlan.normalizedCandidatePrices.length,
    minLot: input.minLot,
    lotStep: input.lotStep,
  })
  if (!allocation.ok) return { ok: false, mode: input.pricePlan.mode, reason: allocation.reason }

  const fundedPrices = input.pricePlan.normalizedCandidatePrices.slice(0, allocation.fundedLayerCount)
  const unfundedPrices = input.pricePlan.normalizedCandidatePrices.slice(allocation.fundedLayerCount)
  const unfundedIndexes = unfundedPrices.map((_, idx) => allocation.fundedLayerCount + idx)

  return freezeSuccess({
    ...input.pricePlan,
    actualLayerCount: allocation.fundedLayerCount,
    fundedPrices: Object.freeze(fundedPrices),
    unfundedPrices: Object.freeze(unfundedPrices),
    unfundedIndexes: Object.freeze(unfundedIndexes),
    lots: allocation.lots,
    intendedTotalLot: allocation.intendedTotalLot,
    allocatedTotalLot: allocation.allocatedTotalLot,
    unallocatedLot: allocation.unallocatedLot,
    reasons: uniqueReasons([...input.pricePlan.reasons, ...allocation.reasons]),
  })
}

export function calculateStaticLayerPlan(
  input: StaticLayerPricePlanInput & Pick<CalculatedLayerPlanInput, 'intendedTotalLot' | 'minLot' | 'lotStep'>,
): CalculatedLayerPlanResult {
  const pricePlan = calculateStaticLayerPrices(input)
  if (!pricePlan.ok) return pricePlan
  return buildCalculatedLayerPlan({ pricePlan, ...input })
}

export function calculateDynamicLayerPlan(
  input: DynamicLayerPricePlanInput & Pick<CalculatedLayerPlanInput, 'intendedTotalLot' | 'minLot' | 'lotStep'>,
): CalculatedLayerPlanResult {
  const pricePlan = calculateDynamicLayerPrices(input)
  if (!pricePlan.ok) return pricePlan
  return buildCalculatedLayerPlan({ pricePlan, ...input })
}
