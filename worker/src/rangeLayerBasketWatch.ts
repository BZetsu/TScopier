import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldLockBasketLayering } from './virtualPendingMonitor'
import {
  loadRangeLayerTillCloseForSignal,
  stopRangeLayeringUnlessEnabled,
} from './rangeLayerTillClose'
import { setTpTouchedLock } from './rangePendingFireGuard'

export type RangeLayerBasketTradeRow = {
  signal_id: string
  broker_account_id: string
  user_id: string
  direction: string
  tp: number | null
  status: string
}

export type WatchRangeLayeringBasketsArgs = {
  signalIds: string[]
  brokerIds: string[]
  symbol: string
  bid: number
  ask: number
  /** When set, write trade_execution_logs with this action on stop. */
  logAction?: string
}

/**
 * Detect TP-touch / partial basket close and stop range layering when layer-till-close is OFF.
 * Shared by virtual and broker-pending range monitors.
 */
export async function watchRangeLayeringBasketEvents(
  supabase: SupabaseClient,
  args: WatchRangeLayeringBasketsArgs,
): Promise<Set<string>> {
  const touched = new Set<string>()
  const { signalIds, brokerIds, symbol, bid, ask, logAction = 'range_layering_stopped' } = args
  if (!signalIds.length || !brokerIds.length || !symbol) return touched

  const { data, error } = await supabase
    .from('trades')
    .select('signal_id,broker_account_id,user_id,direction,tp,status')
    .in('signal_id', signalIds)
    .in('broker_account_id', brokerIds)
    .eq('symbol', symbol)
    .in('status', ['open', 'closed'])

  if (error) {
    console.warn(`[rangeLayerBasketWatch] tp-touch scan failed: ${error.message}`)
    return touched
  }

  const byBasket = new Map<string, RangeLayerBasketTradeRow[]>()
  for (const row of (data ?? []) as RangeLayerBasketTradeRow[]) {
    const basketKey = `${row.signal_id}|${row.broker_account_id}`
    const arr = byBasket.get(basketKey) ?? []
    arr.push(row)
    byBasket.set(basketKey, arr)
  }

  for (const [basketKey, rows] of byBasket) {
    const openRows = rows.filter(r => r.status === 'open')
    const closedCount = rows.length - openRows.length
    const direction = String((openRows[0] ?? rows[0])?.direction ?? '').toLowerCase()
    const openTps = openRows
      .map(r => Number(r.tp))
      .filter(tp => Number.isFinite(tp) && tp > 0)
    const decision = shouldLockBasketLayering({
      direction,
      openTps,
      openCount: openRows.length,
      closedCount,
      bid,
      ask,
    })
    if (!decision.lock) continue

    const [signalId, brokerAccountId] = basketKey.split('|')
    if (!signalId || !brokerAccountId) continue
    const userId = (openRows[0] ?? rows[0])?.user_id
    if (!userId) continue

    const layerTillClose = await loadRangeLayerTillCloseForSignal(
      supabase,
      signalId,
      brokerAccountId,
    )
    if (layerTillClose) {
      await setTpTouchedLock(supabase, {
        signalId,
        brokerAccountId,
        symbol,
        userId,
        lockReason: decision.reason ?? 'tp_touched',
        triggerPrice: decision.triggerPrice ?? null,
        triggerSide: decision.triggerSide ?? null,
      })
      continue
    }

    const { stopped, deleted } = await stopRangeLayeringUnlessEnabled(
      supabase,
      { signalId, brokerAccountId, symbol, userId },
      decision.reason ?? 'tp_touched',
    )
    if (!stopped) continue
    touched.add(basketKey)

    try {
      await supabase.from('trade_execution_logs').insert({
        user_id: userId,
        signal_id: signalId,
        broker_account_id: brokerAccountId,
        action: logAction,
        status: 'info',
        request_payload: {
          symbol,
          direction,
          trigger_price: decision.triggerPrice,
          trigger_side: decision.triggerSide,
          lock_trigger: decision.reason,
          closed_trades: closedCount,
          open_trades: openRows.length,
          bid,
          ask,
          deleted_rows: deleted,
          lock_reason: 'layering_stopped',
        } as unknown as Record<string, unknown>,
      })
    } catch { /* best-effort */ }
  }

  return touched
}
