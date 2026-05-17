import { isTradableInstrumentSymbol, sanitizeParsedSymbol } from "../tradableSymbol.ts"
import { acquireOpenAiSlot, parseRetryAfterMs } from "./openAiThrottle.ts"

export interface RefineSignalResult {
  parsed: Record<string, unknown>
  source: "openai"
}

const SYSTEM_PROMPT = `You extract structured trading signals from Telegram forex/crypto/index signal channels.
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
- At least one of sl or tp must be present for buy/sell.
- Parse numbers as written; do not invent prices not in the text.`

async function callOpenAiJson(
  env: { get(name: string): string | undefined },
  userContent: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = (env.get("OPENAI_API_KEY") ?? "").trim()
  if (!apiKey) return null
  const model = (env.get("OPENAI_MODEL") ?? "gpt-4o-mini").trim()

  await acquireOpenAiSlot(env)

  const doFetch = async () => {
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent.slice(0, 12_000) },
        ],
      }),
    })

    const body = await res.json().catch(() => ({})) as {
      error?: { message?: string }
      choices?: Array<{ message?: { content?: string } }>
    }

    if (!res.ok) {
      const msg = body.error?.message ?? `OpenAI HTTP ${res.status}`
      const err = new Error(msg)
      if (res.status === 429) {
        const wait = parseRetryAfterMs(msg) ?? 60_000
        await new Promise((r) => setTimeout(r, Math.min(wait + 500, 90_000)))
        throw err
      }
      throw err
    }

    const content = body.choices?.[0]?.message?.content
    if (!content) return null
    try {
      return JSON.parse(content) as Record<string, unknown>
    } catch {
      return null
    }
  }

  try {
    return await doFetch()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/rate limit/i.test(msg)) {
      await acquireOpenAiSlot(env)
      return await doFetch()
    }
    throw e
  }
}

function normalizeOpenAiParsed(parsed: Record<string, unknown>): RefineSignalResult | null {
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

export async function refineSignalWithOpenAI(
  rawMessage: string,
  env: { get(name: string): string | undefined },
): Promise<RefineSignalResult | null> {
  if (!rawMessage.trim()) return null
  const parsed = await callOpenAiJson(env, rawMessage)
  if (!parsed) return null
  return normalizeOpenAiParsed(parsed)
}

/** Batch up to 8 messages in one OpenAI call (much slower rate-limit burn). */
export async function refineSignalsBatchWithOpenAI(
  messages: string[],
  env: { get(name: string): string | undefined },
): Promise<Array<RefineSignalResult | null>> {
  if (!messages.length) return []
  if (messages.length === 1) {
    const one = await refineSignalWithOpenAI(messages[0]!, env)
    return [one]
  }

  const numbered = messages
    .map((m, i) => `--- MESSAGE ${i + 1} ---\n${m.slice(0, 1500)}`)
    .join("\n\n")

  const batchPrompt = `Parse each MESSAGE block below. Return JSON:
{"results":[{"index":1,"action":"buy"|"sell"|"ignore","symbol":string|null,"entry_price":number|null,"sl":number|null,"tp":number[],"confidence":number}, ...]}
One result per message, same order. index matches MESSAGE number.

${numbered}`

  const parsed = await callOpenAiJson(env, batchPrompt)
  if (!parsed) return messages.map(() => null)

  const results = parsed.results
  if (!Array.isArray(results)) return messages.map(() => null)

  const out: Array<RefineSignalResult | null> = messages.map(() => null)
  for (const row of results) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const idx = Number(r.index) - 1
    if (!Number.isFinite(idx) || idx < 0 || idx >= messages.length) continue
    const normalized = normalizeOpenAiParsed(r)
    if (normalized) out[idx] = normalized
  }
  return out
}

/** Heuristic: worth calling OpenAI when deterministic + lenient parse missed. */
export function messageLikelyNeedsAiRefine(rawMessage: string): boolean {
  const t = rawMessage.toLowerCase()
  if (!/\b(buy|sell|long|short)\b/.test(t)) return false
  if (!/\b(sl|stop|tp|target|take\s*profit|entry|gold|xau|eur|gbp|btc|us30|nas)\b/.test(t)) {
    if (!/\d{3,}(?:\.\d+)?/.test(t)) return false
  }
  return true
}
