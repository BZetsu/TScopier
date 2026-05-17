import { isTradableInstrumentSymbol, sanitizeParsedSymbol } from "../tradableSymbol.ts"

export interface RefineSignalResult {
  parsed: Record<string, unknown>
  source: "openai"
}

/**
 * Optional LLM pass when deterministic parse-signal did not yield a tradeable row.
 * Requires OPENAI_API_KEY on the edge runtime.
 */
export async function refineSignalWithOpenAI(
  rawMessage: string,
  env: { get(name: string): string | undefined },
): Promise<RefineSignalResult | null> {
  const apiKey = (env.get("OPENAI_API_KEY") ?? "").trim()
  if (!apiKey || !rawMessage.trim()) return null

  const model = (env.get("OPENAI_MODEL") ?? "gpt-4o-mini").trim()

  const system = `You extract structured trading signals from Telegram forex/crypto/index signal channels.
Return ONLY valid JSON (no markdown) with this shape:
{
  "action": "buy" | "sell" | "ignore",
  "symbol": string | null,
  "entry_price": number | null,
  "entry_zone_low": number | null,
  "entry_zone_high": number | null,
  "sl": number | null,
  "tp": number[],
  "lot_size": number | null,
  "confidence": number
}
Rules:
- symbol must be a real instrument: forex pairs (EURUSD), metals (XAUUSD), crypto (BTCUSDT), indices (US30, NAS100, GER40).
- Never use random English words as symbols.
- If the message is not a trade entry (admin, joined, weekly recap, no instrument), action must be "ignore".
- entry_price may be null for "at market", "now", or when only SL/TP are given — backtest will use the price at signal time.
- At least one of sl or tp must be present for buy/sell (unless clearly a market order with both in the message).
- Parse numbers as written; do not invent prices not in the text.`

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: rawMessage.slice(0, 8000) },
      ],
    }),
  })

  const body = await res.json().catch(() => ({})) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  }

  if (!res.ok) {
    const msg = body.error?.message ?? `OpenAI HTTP ${res.status}`
    throw new Error(msg)
  }

  const content = body.choices?.[0]?.message?.content
  if (!content) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }

  const action = String(parsed.action ?? "ignore").toLowerCase()
  if (action !== "buy" && action !== "sell") return null

  const symbol = sanitizeParsedSymbol(
    typeof parsed.symbol === "string" ? parsed.symbol : null,
  )
  if (!symbol || !isTradableInstrumentSymbol(symbol)) return null

  parsed.action = action
  parsed.symbol = symbol

  return { parsed, source: "openai" }
}

/** Heuristic: worth calling OpenAI when deterministic parse missed a likely entry signal. */
export function messageLikelyNeedsAiRefine(rawMessage: string): boolean {
  const t = rawMessage.toLowerCase()
  if (!/\b(buy|sell|long|short)\b/.test(t)) return false
  if (!/\b(sl|stop\s*loss|tp|take\s*profit|target|entry|@\s*\d|\d{2,}(?:\.\d+)?)\b/.test(t)) {
    return false
  }
  return true
}
