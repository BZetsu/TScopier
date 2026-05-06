import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const METAAPI_TOKEN = Deno.env.get("METAAPI_TOKEN") ?? ""
const METAAPI_BASE = "https://mt-client-api-v1.london.agiliumtrade.ai"

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
}

async function getMarketPrice(accountId: string, symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${METAAPI_BASE}/users/current/accounts/${accountId}/symbols/${symbol}/current-price`,
      { headers: { "auth-token": METAAPI_TOKEN } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.bid ?? data.ask ?? null
  } catch {
    return null
  }
}

async function placeOrder(accountId: string, order: Record<string, unknown>) {
  const res = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/trade`,
    {
      method: "POST",
      headers: {
        "auth-token": METAAPI_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? `MetaAPI error ${res.status}`)
  return data
}

async function modifyOrder(accountId: string, orderId: string, updates: Record<string, unknown>) {
  const res = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/trade`,
    {
      method: "POST",
      headers: {
        "auth-token": METAAPI_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ actionType: "POSITION_MODIFY", positionId: orderId, ...updates }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? `MetaAPI modify error ${res.status}`)
  return data
}

async function closePosition(accountId: string, orderId: string) {
  const res = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/trade`,
    {
      method: "POST",
      headers: {
        "auth-token": METAAPI_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? `MetaAPI close error ${res.status}`)
  return data
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
    const { signal_id, parsed } = body as { signal_id: string; parsed: ParsedSignal }

    if (!signal_id || !parsed) {
      return Response.json({ error: "signal_id and parsed required" }, { status: 400, headers: corsHeaders })
    }

    // Load signal to get user_id
    const { data: signal } = await supabase
      .from("signals")
      .select("user_id, channel_id, is_modification, parent_signal_id")
      .eq("id", signal_id)
      .single()

    if (!signal) {
      return Response.json({ error: "Signal not found" }, { status: 404, headers: corsHeaders })
    }

    // Load broker account
    const { data: brokerAccount } = await supabase
      .from("broker_accounts")
      .select("*")
      .eq("user_id", signal.user_id)
      .eq("is_active", true)
      .maybeSingle()

    if (!brokerAccount) {
      await supabase.from("signals").update({ status: "skipped", skip_reason: "No active broker account" }).eq("id", signal_id)
      return Response.json({ skipped: true, reason: "No active broker account" }, { headers: corsHeaders })
    }

    // Load channel-level overrides
    let pipTolerance = brokerAccount.pip_tolerance
    let lotSize = brokerAccount.default_lot_size

    if (signal.channel_id) {
      const { data: channel } = await supabase
        .from("telegram_channels")
        .select("pip_tolerance_override, lot_size_override")
        .eq("id", signal.channel_id)
        .maybeSingle()

      if (channel?.pip_tolerance_override) pipTolerance = channel.pip_tolerance_override
      if (channel?.lot_size_override) lotSize = channel.lot_size_override
    }

    if (parsed.lot_size) lotSize = parsed.lot_size

    const accountId = brokerAccount.metaapi_account_id

    // Handle close action
    if (parsed.action === "close" && signal.parent_signal_id) {
      const { data: parentTrade } = await supabase
        .from("trades")
        .select("metaapi_order_id")
        .eq("signal_id", signal.parent_signal_id)
        .maybeSingle()

      if (parentTrade?.metaapi_order_id) {
        await closePosition(accountId, parentTrade.metaapi_order_id)
        await supabase.from("trades").update({ status: "closed", closed_at: new Date().toISOString() }).eq("signal_id", signal.parent_signal_id)
        await supabase.from("signals").update({ status: "executed" }).eq("id", signal_id)
        return Response.json({ executed: true, action: "close" }, { headers: corsHeaders })
      }
    }

    // Handle modify action
    if (parsed.action === "modify" && signal.parent_signal_id) {
      const { data: parentTrade } = await supabase
        .from("trades")
        .select("metaapi_order_id")
        .eq("signal_id", signal.parent_signal_id)
        .maybeSingle()

      if (parentTrade?.metaapi_order_id) {
        const updates: Record<string, unknown> = {}
        if (parsed.sl !== null) updates.stopLoss = parsed.sl
        if (parsed.tp?.length) updates.takeProfit = parsed.tp[0]
        await modifyOrder(accountId, parentTrade.metaapi_order_id, updates)
        await supabase.from("signals").update({ status: "executed" }).eq("id", signal_id)
        return Response.json({ executed: true, action: "modify" }, { headers: corsHeaders })
      }
    }

    // Handle breakeven action
    if (parsed.action === "breakeven" && signal.parent_signal_id) {
      const { data: parentTrade } = await supabase
        .from("trades")
        .select("metaapi_order_id, entry_price")
        .eq("signal_id", signal.parent_signal_id)
        .maybeSingle()

      if (parentTrade?.metaapi_order_id && parentTrade.entry_price) {
        await modifyOrder(accountId, parentTrade.metaapi_order_id, { stopLoss: parentTrade.entry_price })
        await supabase.from("signals").update({ status: "executed" }).eq("id", signal_id)
        return Response.json({ executed: true, action: "breakeven" }, { headers: corsHeaders })
      }
    }

    // For buy/sell: apply pip tolerance filter
    if (parsed.action === "buy" || parsed.action === "sell") {
      if (!parsed.symbol) {
        await supabase.from("signals").update({ status: "skipped", skip_reason: "No symbol detected" }).eq("id", signal_id)
        return Response.json({ skipped: true, reason: "No symbol detected" }, { headers: corsHeaders })
      }

      const signalPrice = parsed.entry_price ?? parsed.entry_zone_low ?? parsed.entry_zone_high
      if (signalPrice) {
        const marketPrice = await getMarketPrice(accountId, parsed.symbol)
        if (marketPrice) {
          // Rough pip calculation (works for most forex pairs)
          const pipDiff = Math.abs(marketPrice - signalPrice) * 10000
          if (pipDiff > pipTolerance) {
            const reason = `Pip tolerance exceeded: ${pipDiff.toFixed(1)} pips (limit: ${pipTolerance})`
            await supabase.from("signals").update({ status: "skipped", skip_reason: reason }).eq("id", signal_id)
            return Response.json({ skipped: true, reason }, { headers: corsHeaders })
          }
        }
      }

      // Build the order
      const actionType = parsed.action === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL"
      const order: Record<string, unknown> = {
        actionType,
        symbol: parsed.symbol,
        volume: lotSize,
      }

      if (parsed.sl !== null) order.stopLoss = parsed.sl
      if (parsed.tp?.length) order.takeProfit = parsed.tp[0]

      // Use limit order if specific entry price provided
      if (signalPrice) {
        order.actionType = parsed.action === "buy" ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_SELL_LIMIT"
        order.openPrice = signalPrice
      }

      const result = await placeOrder(accountId, order)

      // Save trade record
      const { data: tradeRow } = await supabase
        .from("trades")
        .insert({
          user_id: signal.user_id,
          signal_id,
          broker_account_id: brokerAccount.id,
          metaapi_order_id: result.orderId ?? result.positionId ?? null,
          symbol: parsed.symbol,
          direction: parsed.action,
          entry_price: parsed.entry_price ?? parsed.entry_zone_low ?? null,
          sl: parsed.sl,
          tp: parsed.tp?.[0] ?? null,
          lot_size: lotSize,
          status: "open",
          opened_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      await supabase.from("signals").update({ status: "executed" }).eq("id", signal_id)

      return Response.json({ executed: true, trade_id: tradeRow?.id }, { headers: corsHeaders })
    }

    // Unknown or unhandled action
    await supabase.from("signals").update({ status: "skipped", skip_reason: `Unhandled action: ${parsed.action}` }).eq("id", signal_id)
    return Response.json({ skipped: true }, { headers: corsHeaders })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("execute-trade error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
