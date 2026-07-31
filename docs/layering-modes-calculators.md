# Layering Modes Calculators

Phase B adds pure calculator modules for future Static and Dynamic range-layering
execution. These helpers are not integrated into the planner, executor,
Supabase persistence, queues, Telegram parsing, broker dispatch, or frontend UI.
Legacy range-layering behavior remains the only production execution path.

## Static Layering

Static layering divides the original normalized signal range into a fixed total
number of layers. The total layer count includes the first/immediate entry.

- BUY plans are ordered from `rangeHigh` down to `rangeLow`.
- SELL plans are ordered from `rangeLow` up to `rangeHigh`.
- A one-layer BUY uses `rangeHigh`; a one-layer SELL uses `rangeLow`.
- Two or more layers divide the inclusive range into `layerCount - 1` equal
  intervals.
- Prices are rounded with the worker symbol-digits convention.
- Duplicate rounded prices are removed without shifting or inventing prices.

The calculator requires normalized input ranges: `rangeLow <= rangeHigh`.
Parser/range normalization remains a separate responsibility.

## Dynamic Layering

Dynamic layering uses the actual first broker fill as the immutable anchor. The
first fill counts as one layer, and `maxTotalLayers` includes that first fill.

- BUY remaining levels move downward from the anchor by `stepPips * pipSize`.
- SELL remaining levels move upward from the anchor by `stepPips * pipSize`.
- Remaining levels never leave the original normalized signal range.
- A step that lands exactly on the far boundary is included.
- Partial final steps are not created.
- If the first fill is outside the original range, the result preserves the
  anchor as the only layer and reports `anchor_outside_range`.
- The raw first fill is retained separately from the rounded executable anchor.
  If the rounded executable anchor cannot be represented inside the original
  range at the configured symbol precision, the calculator returns
  `anchor_unrepresentable_at_precision` instead of emitting an out-of-range
  price.
- If less than one full step remains, the result reports
  `insufficient_remaining_distance`.

Dynamic spacing is pips-only for V1. The calculator does not use current quotes,
gap-fill reanchoring, or continuous price chasing.

## Price Normalization

`normalizeLayerPrices()` rounds candidate prices with `Number(price.toFixed(symbolDigits))`,
normalizes negative zero to zero, preserves directional order, removes exact
duplicates after rounding, and reports duplicate source indexes. It does not
sort, shift, or pad levels.

## Lot Allocation

`allocateLayerLots()` is deterministic and uses integer lot-step units:

- The allocated total never exceeds the intended total.
- Every non-zero leg is at least `minLot` and aligned to `lotStep`.
- When `minLot` is not aligned to `lotStep`, the effective minimum is the
  smallest whole lot-step value greater than or equal to `minLot`.
- Remainder lot-step units are assigned to earlier layers in execution order.
- If the intended total cannot fund every layer at `minLot`, the funded layer
  count is reduced and unfunded prices are removed by the combined plan builder.
- If the intended total is below `minLot`, allocation fails; it never rounds up
  above the intended total.

Duplicate prices are removed before allocation, so lot is redistributed across
the final unique broker-valid layer count. Combined plan results distinguish:

- `candidateRawPrices`: all calculator-generated raw diagnostic candidates.
- `normalizedCandidatePrices`: all unique valid rounded candidates before lot
  funding is applied.
- `fundedPrices`: the canonical active price list aligned one-to-one with
  `lots`.
- `unfundedPrices` / `unfundedIndexes`: candidates removed because the intended
  total lot could not safely fund them.

Only `fundedPrices` may become executable pending legs in a future execution
phase. Phase C persists immutable non-executable plan records first; candidate
prices remain diagnostic only. Reason codes are deduplicated while preserving
insertion order.

## Phase C

Phase C persists immutable plan snapshots in `layering_plans` and keeps them in
`prepared` state. It does not write active `range_pending_legs` rows, wire the
calculators into the planner/executor, or enable Static/Dynamic broker execution.
See [`layering-plan-persistence.md`](layering-plan-persistence.md).

Do not claim these modes are available to users until the planner, activation,
materialization, restart recovery, and broker execution integration are complete.
