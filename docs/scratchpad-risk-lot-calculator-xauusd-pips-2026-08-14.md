# Scratchpad — Risk/lot calculator XAUUSD pips vs points (2026-08-14)

## Report
Risk & lot size calculator modal does not accurately use pips for XAUUSD; seems to calculate in points.

User confirmed: treats **1 pip as 0.01** (broker point) instead of **0.1** (trader gold pip). Symbol may be XAUUSD / XAUUSDm / GOLD.

## Questions
1. Where is the calculator modal implemented?
2. How is pip size / pip value derived for XAUUSD?
3. Does it use MT `point` (0.01) instead of gold pip (0.1)?

## Hypotheses
- H1: Calculator uses `point` or `digits`-based size as pip for all symbols.
- H2: XAUUSD pip helper exists elsewhere but calculator bypasses it.
- H3: Display says "pips" but math uses points (10x error for gold).
- H4: `GOLD` alias classified as `other` → FX-like pip math.
- H5: Modal prefers sticky parent `livePipQuote` over the symbol typed in the modal.

## Evidence
- Modal: `src/components/configure/RiskLotCalculatorModal.tsx`
- Math: `src/lib/riskLotCalculator.ts` → `pipValueForLots(quote, lots) * slPips`
- Pip quote: `src/lib/pipCalculator.ts` + `src/lib/pipMath.ts`
- **CONFIRMED H4:** `classifySymbol('GOLD')` was `'other'` (metal prefixes only `XAU/XAG/...`). Then defaults used FX-like `point=0.00001` → wrong pip. After alias fix → `'metal'`, `pipPrice=0.1`.
- **CONFIRMED H5:** `quote = externalPipQuote ?? pipQuoteForSymbol(effectiveSymbol)` ignored form-symbol changes when parent passed a quote.
- **XAUUSD path:** `pipCalculator('XAUUSD', 0.01, 2)` already returned `pipPrice: 0.1` when classified as metal; bug showed up for GOLD alias + sticky wrong quote.
- Convention elsewhere: `signalPipPrice('GOLD'|'XAUUSD') === 0.1` (backtest already correct).

## Fix
1. `normalizePipInstrument`: GOLD/XAU → XAUUSD, SILVER/XAG → XAGUSD (frontend + worker `pipMath`).
2. Metal pip price always uses normalized instrument so gold pip stays **0.1**.
3. Modal derives quote from **effective modal symbol** (only reuse parent quote when same class/pipPrice).
4. Tests: 30 SL pips × 0.01 lot on XAUUSD/GOLD = **$3** (not $0.30).

## Status
Fixed in code; needs frontend deploy to reach users.
