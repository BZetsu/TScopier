/**
 * Sends Expo push notifications for trade alerts.
 *
 * Called by:
 * - DB trigger on trade_execution_logs (service role)
 * - Manual/admin callers with { user_id, title, body }
 *
 * Secrets: EXPO_ACCESS_TOKEN (optional but recommended), SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PushRequest {
  user_id: string
  title?: string
  body?: string
  action?: string
  symbol?: string | null
  status?: string
  href?: string
}

const ACTION_TITLES: Record<string, string> = {
  order_send: 'Trade executed',
  signal_entry_pending_filled: 'Pending filled',
  virtual_pending_fired: 'Layer filled',
  merge_modify_summary: 'Stops updated',
  mgmt_modify: 'Trade modified',
  mgmt_breakeven: 'Moved to breakeven',
  mgmt_partial_breakeven: 'Partial breakeven',
  merge_routed_modify_only: 'Stops updated',
  signal_merge_into_open_trade: 'Signal merged',
  basket_leg_modify: 'Basket updated',
  mgmt_close: 'Trade closed',
  mgmt_close_worse_entries: 'Trades closed',
  cwe_close: 'Trade closed',
  opposite_signal_close: 'Opposite signal close',
  partial_tp_fired: 'Partial take profit',
}

function buildCopy(payload: PushRequest): { title: string; body: string } {
  if (payload.title && payload.body) {
    return { title: payload.title, body: payload.body }
  }

  const action = payload.action ?? 'update'
  const title = ACTION_TITLES[action] ?? 'Trade update'
  const symbol = payload.symbol?.trim()
  const body = symbol
    ? `${symbol.toUpperCase()} · ${action.replace(/_/g, ' ')}`
    : action.replace(/_/g, ' ')

  return { title, body }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = (await req.json()) as PushRequest
    if (!payload.user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('token')
      .eq('user_id', payload.user_id)

    if (tokenError) {
      throw tokenError
    }

    if (!tokens?.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { title, body } = buildCopy(payload)
    const href = payload.href ?? '/(app)/alerts'

    const messages = tokens.map(row => ({
      to: row.token,
      sound: 'default',
      title,
      body,
      data: { href },
      channelId: 'trades',
    }))

    const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN')
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(expoToken ? { Authorization: `Bearer ${expoToken}` } : {}),
      },
      body: JSON.stringify(messages),
    })

    const result = await res.json()

    // Drop DeviceNotRegistered tokens so we stop retrying dead devices.
    const tickets = Array.isArray(result?.data) ? result.data : []
    const stale: string[] = []
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]
      if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
        stale.push(messages[i]?.to)
      }
    }
    if (stale.length) {
      await supabase.from('user_push_tokens').delete().in('token', stale)
    }

    return new Response(JSON.stringify({ sent: messages.length, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
