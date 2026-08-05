# Layering Modes Calculators

Phase B added pure calculator modules for Static and Dynamic range-layering
plans. The calculator functions remain side-effect free: they do not access
Supabase, queues, Telegram, broker clients, environment variables, time, random
IDs, or filesystem/network state. Runtime integration consumes their outputs
only after rollout gates allow preparation, and executable rows are materialized
only from immutable persisted `fundedPrices`/`lots`.

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

## Runtime Integration

The final integration uses these calculators to build versioned
`LayeringPlanSnapshot` metadata. Static can prepare from the original signal
range before the first immediate order. Dynamic is two-stage: the first broker
fill is sent through the existing immediate path, then the actual fill price and
actual fill lot are used to calculate remaining funded layers. The first layer is
not materialized a second time as a pending leg.

Static/Dynamic still require server-side rollout flags, kill switch off, and an
allowlisted broker account. Broker-native pending orders for Static/Dynamic use
the immutable funded prices/lots plus deterministic per-leg references for
supported FxSocket MT4/MT5 accounts; unsupported adapters fail closed and never
fall back to virtual execution or Legacy behavior.
See [`layering-plan-persistence.md`](layering-plan-persistence.md).
