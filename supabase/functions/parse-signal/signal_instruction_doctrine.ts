/**
 * Stable natural-language rules appended to the LLM system prompt (fast path does not use this).
 * Keep concise; place long pasted logs in signal_formats_corpus.ts behind OPENAI_SIGNAL_USE_FEW_SHOTS.
 */
export const SIGNAL_INSTRUCTION_DOCTRINE = `
## Natural-language mapping (authoritative)

**Market entries**
- Phrases like "Buy now", "Sell now", "Long BTC", "Short gold now", "Enter long" with a clear instrument → action buy or sell; resolve symbol from text (BTC→BTCUSD/BTCUSDT per message), never assume gold unless text says gold/XAU.
- "At market" / "market order" / "mkt" → treat as immediate entry unless clearly analysis-only.

**Management: take profit / stop loss**
- "Set TP @ 80938", "TP = 80938", "Take profit 80938", "Target 98500", emoji lines (e.g. profit emoji + TP1) → action modify; put numeric levels in tp[].
- "Adjust SL to 70500", "SL @ 70000", "Move stop loss to …", "Set stop to …" → action modify; put stop in sl; merge with any tp[] found in the same message.

**Management: close / scale / breakeven**
- "Close", "Close now", "Close all", "Close all now", "Close all trades", "Flatten", "Exit trade/position" → action close (symbol from text if present; else null for single-position correlation).
- "Close BTCUSD trade now" / "Close gold position" → action close with symbol from text.
- "Close half", "50% off", "partial close", "secure 50%" → action partial_profit.
- "Breakeven", "BE", "move SL to entry" → action breakeven.

**Non-signals**
- Commentary, recap, screenshots without instructions → ignore.
`.trim()
