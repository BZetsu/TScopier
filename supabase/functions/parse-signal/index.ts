import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? ""

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
- symbol should be the forex pair or instrument (e.g. EURUSD, XAUUSD, US30, BTCUS)
- if the message contains a broker or server hint, use it to determine the symbol
- if the message contains a symbol, use it to determine the broker or server
- if the message contains a broker or server hint and a symbol, use the symbol
`

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

function parseSimpleSignal(message: string): ParsedSignal | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim()
  if (!text) return null

  const isGold = /\b(gold|xau|xauusd)\b/.test(text)
  const isBuy = /\b(buy|long)\b/.test(text)
  const isSell = /\b(sell|short)\b/.test(text)
  const isNow = /\b(now|instant|market)\b/.test(text)

  if (!isGold || !isNow) return null
  if (isBuy === isSell) return null

  // Extract SL (e.g. "sl 3300", "stop loss: 3300")
  const slMatch = text.match(/\b(?:sl|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
  const sl = slMatch ? Number(slMatch[1]) : null

  // Extract TP values supporting: "tp 3350", "tp1 3350 tp2 3360", "take profit 3350"
  const tpMatches = [...text.matchAll(/\b(?:tp\d*|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)]
  const tp = tpMatches
    .map(m => Number(m[1]))
    .filter(n => Number.isFinite(n))

  return {
    action: isBuy ? "buy" : "sell",
    symbol: "XAUUSD",
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl,
    tp,
    lot_size: null,
    confidence: 0.99,
    raw_instruction: message,
  }
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
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 400,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? ""

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

    // Optional channel profile hints (read-only; missing row is fine).
    let channelHints: string | null = null
    if (signal.channel_id) {
      const { data: prof } = await supabase
        .from("channel_signal_profiles")
        .select(
          "signal_type, tp_style, sl_style, entry_type, most_traded_asset, estimated_tp_pips, estimated_sl_pips, analysis_summary",
        )
        .eq("channel_id", signal.channel_id)
        .maybeSingle()
      if (prof && typeof prof === "object") {
        const hint = compactChannelProfile(prof as Record<string, unknown>)
        if (hint) channelHints = hint
      }
    }

    // Parse message (deterministic fast-path first, then LLM fallback).
    const parsed =
      parseSimpleSignal(signal.raw_message)
      ?? await parseWithOpenAI(signal.raw_message, channelHints)

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

    // If valid trade signal, trigger execution
    if (parsed.action !== "ignore" && parsed.confidence >= 0.7) {
      // Fire-and-forget trade execution
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            // #region agent log
            fetch('http://127.0.0.1:7911/ingest/9eb853c4-6a95-4829-9e4e-863df98c5251',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7e177e'},body:JSON.stringify({sessionId:'7e177e',runId:'run1',hypothesisId:'H3',location:'supabase/functions/parse-signal/index.ts:138',message:'execute-trade dispatch',data:{signalId:signal_id,action:parsed.action,confidence:parsed.confidence},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            const execRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/execute-trade`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ signal_id, parsed }),
            })
            if (!execRes.ok) {
              const raw = await execRes.text()
              // #region agent log
              fetch('http://127.0.0.1:7911/ingest/9eb853c4-6a95-4829-9e4e-863df98c5251',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7e177e'},body:JSON.stringify({sessionId:'7e177e',runId:'run1',hypothesisId:'H3',location:'supabase/functions/parse-signal/index.ts:149',message:'execute-trade non-2xx',data:{signalId:signal_id,status:execRes.status,body:raw.slice(0,300)},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              const reason = `Execute trade failed (${execRes.status}): ${raw.slice(0, 300)}`
              await supabase.from("signals").update({ status: "failed", skip_reason: reason }).eq("id", signal_id)
              console.error("parse-signal execute-trade failed:", reason)
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "execute-trade network error"
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
