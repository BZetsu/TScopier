import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import { lenientParseTradeMessage } from "./lenientParse.ts"
import { tradeableFromParsed } from "./parsedToUpsert.ts"

export interface BacktestImportResult {
  imported: number
  messages_scanned: number
  parse_attempted: number
  parse_tradeable: number
  lenient_parsed: number
  errors: string[]
}

type WorkerMessage = {
  telegram_message_id: string
  raw_message: string
  signal_at: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseDelayMs(env: { get(name: string): string | undefined }): number {
  const n = Number(env.get("BACKTEST_PARSE_DELAY_MS") ?? "80")
  return Number.isFinite(n) && n >= 0 ? n : 80
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
): Promise<BacktestImportResult> {
  const fromIso = new Date(dateFrom).toISOString()
  const toIso = new Date(dateTo + "T23:59:59.999Z").toISOString()
  const errors: string[] = []
  let imported = 0
  let messagesScanned = 0
  let parseAttempted = 0
  let parseTradeable = 0
  let lenientParsed = 0

  const parseGap = parseDelayMs(env)

  if (channelIds.length === 0) {
    return {
      imported: 0,
      messages_scanned: 0,
      parse_attempted: 0,
      parse_tradeable: 0,
      lenient_parsed: 0,
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

        if (!resolved.tradeable || !resolved.parsed) continue
        parseTradeable++

        const { error: upsertErr } = await supabase.rpc("upsert_backtest_channel_signal", {
          p_user_id: userId,
          p_channel_id: channelRowId,
          p_signal_id: null,
          p_telegram_message_id: msg.telegram_message_id,
          p_source: "telegram_import",
          p_direction: resolved.tradeable.direction,
          p_symbol: resolved.tradeable.symbol,
          p_entry_price: resolved.tradeable.entry_price,
          p_sl: resolved.tradeable.sl,
          p_tp_levels: resolved.tradeable.tp_levels,
          p_lot_size: resolved.tradeable.lot_size,
          p_raw_message: msg.raw_message,
          p_parsed_data: {
            ...resolved.parsed,
            ...(resolved.tradeable.market_entry ? { market_entry: true } : {}),
          },
          p_signal_at: msg.signal_at,
        })
        if (upsertErr) {
          pushImportError(errors, upsertErr.message)
          continue
        }
        imported++
      } catch (e) {
        pushImportError(errors, e instanceof Error ? e.message : String(e))
      }

      if (parseGap > 0) await sleep(parseGap)
    }
  }

  if (imported === 0 && parseAttempted > 0) {
    errors.push(
      "No tradeable signals stored — messages need buy/sell, a valid symbol, and SL or TP.",
    )
  }

  return {
    imported,
    messages_scanned: messagesScanned,
    parse_attempted: parseAttempted,
    parse_tradeable: parseTradeable,
    lenient_parsed: lenientParsed,
    errors,
  }
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

  return { tradeable, parsed, lenientUsed }
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
