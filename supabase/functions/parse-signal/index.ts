import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { type ParsedSignal as ExecParsed, runExecuteTradeFromPayload } from "../_shared/trade_execution.ts"
import { formatCorpusForSystemPrompt } from "./signal_formats_corpus.ts"
import { SIGNAL_INSTRUCTION_DOCTRINE } from "./signal_instruction_doctrine.ts"
import {
  extractTradableSymbolFromMessage,
  parseDeterministicManagement,
  parseSimpleSignal,
} from "./management_fastpath.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? ""
/** Override via `OPENAI_SIGNAL_MODEL` or `OPENAI_MODEL` (faster models reduce LLM latency). */
const OPENAI_SIGNAL_MODEL = Deno.env.get("OPENAI_SIGNAL_MODEL") ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini"
const OPENAI_SIGNAL_USE_FEW_SHOTS = Deno.env.get("OPENAI_SIGNAL_USE_FEW_SHOTS") === "true"

const SYSTEM_PROMPT = `You are a financial trade signal parser. Extract structured trade instructions from Telegram messages.

Return ONLY a JSON object with this exact shape (no markdown, no explanation):
{
  "action": "buy" | "sell" | "close" | "breakeven" | "partial_profit" | "modify" | "ignore",
  "symbol": string | null,
  "entry_price": number | null,
  "entry_zone_low": number | null,
  "entry_zone_high": number | null,
  "sl": number | null,
  "tp": number[],
  "lot_size": number | null,
  "confidence": number (0-1),
  "raw_instruction": string
}

Rules:
- If optional channel context is appended to the user message (behavior hints for this Telegram source), weigh it as soft guidance — do not refuse to parse if it conflicts with the visible message text.
- If the message contains no trading instruction, set action to "ignore"
- For zone entries like "buy between 1.1200 and 1.1220", set entry_zone_low and entry_zone_high
- For "Set SL to X" or "Move TP to Y" messages, set action to "modify"
- For "Close trade" or "Close all" messages, set action to "close"
- For "Set breakeven" messages, set action to "breakeven"
- tp is always an array (can have multiple targets)
- confidence reflects how certain you are this is a real trade signal (0 = not a trade, 1 = clear trade)
- symbol must match what the message is about ONLY if that instrument appears in the text (or shorthand like BTC, ETH, GOLD, GU, UJ).
- NEVER default to XAUUSD or GOLD unless the message clearly refers to gold, XAU, or XAUUSD. Crypto (BTC/Bitcoin/Ethereum) uses BTCUSD, BTCUSDT, ETHUSD as appropriate—not gold.
- If the message implies close/modify on an unnamed single position only, symbol may be null (execution may correlate to one open trade).
- if the message contains a broker or server hint, use it to refine the symbol
- if the message contains a slash pair ("EUR/USD"), normalize to EURUSD-style
`

function buildLlmSystemPrompt(): string {
  let out = SYSTEM_PROMPT + "\n\n" + SIGNAL_INSTRUCTION_DOCTRINE
  if (OPENAI_SIGNAL_USE_FEW_SHOTS) out += formatCorpusForSystemPrompt()
  return out
}

interface ParsedSignal {
  action: string
  symbol: string | null
  entry_price: number | null
  entry_zone_low: number | null
  entry_zone_high: number | null
  sl: number | null
  tp: number[]
  lot_size: number | null
  confidence: number
  raw_instruction: string
}

/** Coerce LLM / fast-path output so execute-trade always gets consistent types and confidence. */
function normalizeParsedFromModel(raw: unknown, fallbackText: string): ParsedSignal {
  const j = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  let action = String(j.action ?? "ignore").trim().toLowerCase()
  if (action === "long") action = "buy"
  if (action === "short") action = "sell"
  const allowed = new Set(["buy", "sell", "close", "breakeven", "partial_profit", "modify", "ignore"])
  if (!allowed.has(action)) action = "ignore"

  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  let symbol: string | null = null
  if (typeof j.symbol === "string" && j.symbol.trim()) {
    symbol = j.symbol.trim().toUpperCase().replace(/\s+/g, "")
  }

  let tp: number[] = []
  if (Array.isArray(j.tp)) {
    tp = j.tp.map((x) => Number(x)).filter((n) => Number.isFinite(n))
  }

  let confidence = Number(j.confidence)
  // Critical: comparisons like NaN >= 0.7 are false — would skip execution permanently.
  if (!Number.isFinite(confidence)) {
    confidence = action !== "ignore" ? 0.82 : 0
  }
  confidence = Math.min(1, Math.max(0, confidence))

  const raw_instruction =
    typeof j.raw_instruction === "string" && j.raw_instruction.trim().length > 0
      ? j.raw_instruction
      : fallbackText

  return {
    action,
    symbol,
    entry_price: numOrNull(j.entry_price),
    entry_zone_low: numOrNull(j.entry_zone_low),
    entry_zone_high: numOrNull(j.entry_zone_high),
    sl: numOrNull(j.sl),
    tp,
    lot_size: numOrNull(j.lot_size),
    confidence,
    raw_instruction,
  }
}

function toExecParsed(p: ParsedSignal): ExecParsed {
  return {
    action: p.action,
    symbol: p.symbol,
    entry_price: p.entry_price,
    entry_zone_low: p.entry_zone_low,
    entry_zone_high: p.entry_zone_high,
    sl: p.sl,
    tp: p.tp,
    lot_size: p.lot_size,
    confidence: p.confidence,
  }
}

/** Fix LLM hallucination (e.g. XAUUSD on BTC CLOSE) using raw Telegram text. */
function applyRawSymbolRepair(parsed: ParsedSignal, rawMsg: string): ParsedSignal {
  const extracted = extractTradableSymbolFromMessage(rawMsg)

  const cur = parsed.symbol?.toUpperCase() ?? ""
  const goldHints = /\b(gold|xau|xauusd)\b/i.test(rawMsg)
  const btcHints = /\b(btc|bitcoin|btcusd|btcusdt)\b/i.test(rawMsg)
  const mgmt = new Set(["close", "breakeven", "partial_profit", "modify"]).has(parsed.action)

  if (mgmt) {
    if (extracted) return { ...parsed, symbol: extracted }
    if (cur === "XAUUSD" && !goldHints) return { ...parsed, symbol: null }
    return parsed
  }
  if (!extracted) return parsed
  if (
    cur === "XAUUSD" && (!goldHints && (btcHints || extracted.includes("BTC") || extracted.includes("ETH")))
  ) {
    return { ...parsed, symbol: extracted }
  }
  if ((!cur || cur !== extracted) && (btcHints || goldHints || /^[A-Z]{6}$/.test(extracted))) {
    return { ...parsed, symbol: extracted }
  }
  return parsed
}

function compactChannelProfile(row: Record<string, unknown>): string {
  const parts: string[] = []
  const push = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return
    const s = String(v).trim()
    if (!s || s === "unknown") return
    parts.push(k + "=" + s)
  }
  push("signal_type", row.signal_type)
  push("tp_style", row.tp_style)
  push("sl_style", row.sl_style)
  push("entry_type", row.entry_type)
  push("asset", row.most_traded_asset)
  if (row.estimated_tp_pips != null) push("est_tp_pips", row.estimated_tp_pips)
  if (row.estimated_sl_pips != null) push("est_sl_pips", row.estimated_sl_pips)
  if (typeof row.analysis_summary === "string" && row.analysis_summary.trim()) {
    const sum = row.analysis_summary.trim()
    const summaryBody = sum.length > 600 ? sum.slice(0, 600) + "..." : sum
    parts.push("summary=" + summaryBody)
  }
  const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : null
  if (meta?.style_guide && typeof meta.style_guide === "string") {
    const sg = meta.style_guide.trim()
    if (sg) {
      parts.push("channel_style_guide=" + (sg.length > 900 ? sg.slice(0, 900) + "..." : sg))
    }
  }
  return parts.join("; ")
}

async function parseWithOpenAI(message: string, channelHints: string | null): Promise<ParsedSignal> {
  const userContent = channelHints
    ? "Channel context (from prior analysis of this source; may be incomplete):\n" +
      channelHints +
      "\n\n---\nMessage to parse:\n" +
      message
    : message
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_SIGNAL_MODEL,
      messages: [
        { role: "system", content: buildLlmSystemPrompt() },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 384,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status}`)
  }

  const data = await res.json()
  let content = data.choices?.[0]?.message?.content ?? ""
  content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()

  try {
    return JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse OpenAI response: ${content}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const body = await req.json()
    const { signal_id } = body
    // #region agent log
    fetch('http://127.0.0.1:7911/ingest/9eb853c4-6a95-4829-9e4e-863df98c5251',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7e177e'},body:JSON.stringify({sessionId:'7e177e',runId:'run1',hypothesisId:'H3',location:'supabase/functions/parse-signal/index.ts:97',message:'parse-signal invoked',data:{hasSignalId:!!signal_id},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (!signal_id) {
      return Response.json({ error: "signal_id required" }, { status: 400, headers: corsHeaders })
    }

    // Load signal
    const { data: signal, error: signalErr } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signal_id)
      .single()

    if (signalErr || !signal) {
      return Response.json({ error: "Signal not found" }, { status: 404, headers: corsHeaders })
    }

    // Skip channel profile lookup when deterministic parsers win — saves ~50–200ms and removes OpenAI blocker.
    const quickParse =
      parseDeterministicManagement(signal.raw_message)
      ?? parseSimpleSignal(signal.raw_message)

    let channelHints: string | null = null
    if (!quickParse && signal.channel_id) {
      const { data: prof } = await supabase
        .from("channel_signal_profiles")
        .select(
          "signal_type, tp_style, sl_style, entry_type, most_traded_asset, estimated_tp_pips, estimated_sl_pips, analysis_summary, meta",
        )
        .eq("channel_id", signal.channel_id)
        .maybeSingle()
      if (prof && typeof prof === "object") {
        const hint = compactChannelProfile(prof as Record<string, unknown>)
        if (hint) channelHints = hint
      }
    }

    // Parse message: management + multi-asset deterministic paths first, then LLM.
    const rawParsed =
      quickParse
      ?? await parseWithOpenAI(signal.raw_message, channelHints)
    const parsed = applyRawSymbolRepair(
      normalizeParsedFromModel(rawParsed, signal.raw_message),
      signal.raw_message,
    )

    // Update signal with parsed data
    const newStatus = parsed.action === "ignore" ? "skipped" : "parsed"
    const { error: updateErr } = await supabase
      .from("signals")
      .update({
        parsed_data: parsed,
        status: newStatus,
        skip_reason: parsed.action === "ignore" ? "Non-trade message" : null,
      })
      .eq("id", signal_id)

    if (updateErr) {
      return Response.json({ error: updateErr.message }, { status: 500, headers: corsHeaders })
    }

    // If valid trade signal, trigger execution (same isolate as parse — avoids a second Edge Function cold start).
    if (parsed.action !== "ignore" && parsed.confidence >= 0.7) {
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            // #region agent log
            fetch('http://127.0.0.1:7911/ingest/9eb853c4-6a95-4829-9e4e-863df98c5251',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7e177e'},body:JSON.stringify({sessionId:'7e177e',runId:'run1',hypothesisId:'H3',location:'supabase/functions/parse-signal/index.ts:inline-exec',message:'inline execute-trade dispatch',data:{signalId:signal_id,action:parsed.action,confidence:parsed.confidence},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            const execRes = await runExecuteTradeFromPayload({ signal_id, parsed: toExecParsed(parsed) })
            if (!execRes.ok) {
              const raw = await execRes.text()
              if (execRes.status === 503) {
                await supabase.from("signals").update({
                  status: "failed",
                  skip_reason: `Execute trade failed (503): ${raw.slice(0, 240)}`,
                }).eq("id", signal_id)
              }
              console.error("parse-signal inline execute failed:", execRes.status, raw.slice(0, 300))
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "execute-trade error"
            await supabase.from("signals").update({ status: "failed", skip_reason: msg }).eq("id", signal_id)
            console.error("parse-signal execute-trade error:", msg)
          }
        })()
      )
    }

    return Response.json({ parsed, status: newStatus }, { headers: corsHeaders })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("parse-signal error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
