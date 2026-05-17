import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import { lenientParseTradeMessage } from "./lenientParse.ts"
import {
  messageLikelyNeedsAiRefine,
  refineSignalsBatchWithOpenAI,
} from "./refineSignalOpenAI.ts"
import { tradeableFromParsed } from "./parsedToUpsert.ts"

export interface BacktestImportResult {
  imported: number
  messages_scanned: number
  parse_attempted: number
  parse_tradeable: number
  lenient_parsed: number
  ai_refined: number
  errors: string[]
}

type WorkerMessage = {
  telegram_message_id: string
  raw_message: string
  signal_at: string
}

export interface BacktestImportOptions {
  /** When false, skips OpenAI (preview). Default true on full run. */
  useAi?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseDelayMs(env: { get(name: string): string | undefined }): number {
  const n = Number(env.get("BACKTEST_PARSE_DELAY_MS") ?? "80")
  return Number.isFinite(n) && n >= 0 ? n : 80
}

function aiBatchSize(env: { get(name: string): string | undefined }): number {
  const n = Number(env.get("OPENAI_BATCH_SIZE") ?? "5")
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 5
}

/**
 * Fetch Telegram history via worker, parse without touching `signals`,
 * store tradeable rows in `backtest_channel_signals` only.
 */
export async function importTelegramHistoryForBacktest(
  supabase: SupabaseClient,
  env: { get(name: string): string | undefined },
  userId: string,
  channelIds: string[],
  dateFrom: string,
  dateTo: string,
  options: BacktestImportOptions = {},
): Promise<BacktestImportResult> {
  const fromIso = new Date(dateFrom).toISOString()
  const toIso = new Date(dateTo + "T23:59:59.999Z").toISOString()
  const errors: string[] = []
  let imported = 0
  let messagesScanned = 0
  let parseAttempted = 0
  let parseTradeable = 0
  let lenientParsed = 0
  let aiRefined = 0

  const useAi = options.useAi !== false && Boolean((env.get("OPENAI_API_KEY") ?? "").trim())
  const parseGap = parseDelayMs(env)
  const batchSize = aiBatchSize(env)

  if (channelIds.length === 0) {
    return {
      imported: 0,
      messages_scanned: 0,
      parse_attempted: 0,
      parse_tradeable: 0,
      lenient_parsed: 0,
      ai_refined: 0,
      errors: [],
    }
  }

  const workerUrl = (env.get("WORKER_URL") ?? "").trim().replace(/\/+$/, "")
  const workerToken = env.get("WORKER_INTERNAL_TOKEN") ?? ""
  const supabaseUrl = (env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")
  const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

  if (!workerUrl || !workerToken) {
    return {
      imported: 0,
      messages_scanned: 0,
      parse_attempted: 0,
      parse_tradeable: 0,
      lenient_parsed: 0,
      ai_refined: 0,
      errors: ["WORKER_URL not configured — cannot import Telegram history"],
    }
  }

  const workerBase = /^https?:\/\//i.test(workerUrl) ? workerUrl : `https://${workerUrl}`

  const pushImportError = (errors: string[], msg: string) => {
    if (errors.length < 8) {
      errors.push(msg)
      return
    }
    const last = errors[errors.length - 1]
    if (!last?.startsWith("(+")) {
      errors.push("(+more import errors)")
    }
  }

  for (const channelRowId of channelIds) {
    let messages: WorkerMessage[] = []
    try {
      const res = await fetch(`${workerBase}/auth/import_backtest_history`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": workerToken,
        },
        body: JSON.stringify({
          user_id: userId,
          channel_row_id: channelRowId,
          from: dateFrom,
          to: dateTo,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        messages?: WorkerMessage[]
        messages_scanned?: number
        error?: string
      }
      if (!res.ok) {
        pushImportError(errors, data.error ?? `Telegram fetch failed (${res.status})`)
        continue
      }
      messages = data.messages ?? []
      messagesScanned += Number(data.messages_scanned ?? messages.length)
    } catch (e) {
      pushImportError(errors, e instanceof Error ? e.message : String(e))
      continue
    }

    if (messages.length === 0) continue

    const { error: delErr } = await supabase
      .from("backtest_channel_signals")
      .delete()
      .eq("user_id", userId)
      .eq("channel_id", channelRowId)
      .eq("source", "telegram_import")
      .gte("signal_at", fromIso)
      .lte("signal_at", toIso)
    if (delErr) {
      pushImportError(errors, `clear prior import: ${delErr.message}`)
      continue
    }

    const pendingAi: WorkerMessage[] = []

    for (const msg of messages) {
      if (!msg.raw_message?.trim() || !msg.telegram_message_id) continue

      try {
        parseAttempted++
        const resolved = await resolveTradeableParsed(
          supabase,
          serviceKey,
          supabaseUrl,
          channelRowId,
          msg.raw_message,
        )

        if (resolved.lenientUsed) lenientParsed++

        if (resolved.tradeable && resolved.parsed) {
          parseTradeable++
          const ok = await upsertTradeable(
            supabase,
            userId,
            channelRowId,
            msg,
            resolved.tradeable,
            resolved.parsed,
            resolved.aiUsed,
          )
          if (ok) imported++
          else pushImportError(errors, "upsert failed")
          if (parseGap > 0) await sleep(parseGap)
          continue
        }

        if (useAi && messageLikelyNeedsAiRefine(msg.raw_message)) {
          pendingAi.push(msg)
        }
      } catch (e) {
        pushImportError(errors, e instanceof Error ? e.message : String(e))
      }

      if (parseGap > 0) await sleep(parseGap)
    }

    for (let i = 0; i < pendingAi.length; i += batchSize) {
      const chunk = pendingAi.slice(i, i + batchSize)
      try {
        const refined = await refineSignalsBatchWithOpenAI(
          chunk.map((m) => m.raw_message),
          env,
        )
        for (let j = 0; j < chunk.length; j++) {
          const msg = chunk[j]!
          const hit = refined[j]
          if (!hit) continue
          const tradeable = tradeableFromParsed(hit.parsed)
          if (!tradeable) continue
          aiRefined++
          parseTradeable++
          const ok = await upsertTradeable(
            supabase,
            userId,
            channelRowId,
            msg,
            tradeable,
            { ...hit.parsed, parse_source: "openai" },
            true,
          )
          if (ok) imported++
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        pushImportError(errors, `OpenAI batch: ${msg}`)
        if (/rate limit/i.test(msg)) break
      }
    }
  }

  if (imported === 0 && parseAttempted > 0 && !useAi) {
    errors.push(
      "No tradeable signals stored. Enable OPENAI_API_KEY for ambiguous formats, or check channel SL/TP layout.",
    )
  }

  return {
    imported,
    messages_scanned: messagesScanned,
    parse_attempted: parseAttempted,
    parse_tradeable: parseTradeable,
    lenient_parsed: lenientParsed,
    ai_refined: aiRefined,
    errors,
  }
}

async function upsertTradeable(
  supabase: SupabaseClient,
  userId: string,
  channelRowId: string,
  msg: WorkerMessage,
  tradeable: NonNullable<ReturnType<typeof tradeableFromParsed>>,
  parsed: Record<string, unknown>,
  aiUsed: boolean,
): Promise<boolean> {
  const { error: upsertErr } = await supabase.rpc("upsert_backtest_channel_signal", {
    p_user_id: userId,
    p_channel_id: channelRowId,
    p_signal_id: null,
    p_telegram_message_id: msg.telegram_message_id,
    p_source: "telegram_import",
    p_direction: tradeable.direction,
    p_symbol: tradeable.symbol,
    p_entry_price: tradeable.entry_price,
    p_sl: tradeable.sl,
    p_tp_levels: tradeable.tp_levels,
    p_lot_size: tradeable.lot_size,
    p_raw_message: msg.raw_message,
    p_parsed_data: {
      ...parsed,
      ...(tradeable.market_entry ? { market_entry: true } : {}),
      ...(aiUsed ? { parse_source: "openai" } : {}),
    },
    p_signal_at: msg.signal_at,
  })
  return !upsertErr
}

async function resolveTradeableParsed(
  supabase: SupabaseClient,
  serviceKey: string,
  supabaseUrl: string,
  channelRowId: string,
  rawMessage: string,
): Promise<{
  tradeable: ReturnType<typeof tradeableFromParsed>
  parsed: Record<string, unknown> | null
  aiUsed: boolean
  lenientUsed: boolean
}> {
  const parseBody = await invokeParseSignal(supabase, serviceKey, supabaseUrl, {
    parse_only: true,
    channel_id: channelRowId,
    raw_message: rawMessage,
  })

  if (parseBody.error) {
    throw new Error(parseBody.error)
  }

  let parsed = parseBody.parsed ?? null
  let tradeable = parsed ? tradeableFromParsed(parsed) : null
  let lenientUsed = false

  if (!tradeable) {
    const lenient = lenientParseTradeMessage(rawMessage)
    if (lenient) {
      tradeable = tradeableFromParsed(lenient)
      if (tradeable) {
        parsed = lenient
        lenientUsed = true
      }
    }
  }

  return { tradeable, parsed, aiUsed: false, lenientUsed }
}

type ParseSignalBody = {
  parse_only: true
  channel_id: string
  raw_message: string
}

type ParseSignalResult = {
  parsed?: Record<string, unknown>
  status?: string
  error?: string
}

async function invokeParseSignal(
  supabase: SupabaseClient,
  serviceKey: string,
  supabaseUrl: string,
  body: ParseSignalBody,
): Promise<ParseSignalResult> {
  const { data, error } = await supabase.functions.invoke("parse-signal", { body })
  if (!error && data && typeof data === "object") {
    const row = data as ParseSignalResult & { error?: string }
    if (row.error) return { error: row.error }
    return row
  }

  if (serviceKey && supabaseUrl) {
    const parseUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/parse-signal`
    const parseRes = await fetch(parseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify(body),
    })
    const parseBody = await parseRes.json().catch(() => ({})) as ParseSignalResult
    if (!parseRes.ok) {
      return {
        error: parseBody.error
          ?? `parse failed (${parseRes.status}) — redeploy parse-signal with verify_jwt=false`,
      }
    }
    return parseBody
  }

  return {
    error: error?.message ?? "parse-signal invoke failed (check SUPABASE_SERVICE_ROLE_KEY)",
  }
}
