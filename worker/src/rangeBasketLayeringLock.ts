/**
 * Shared TP-touch / basket-close lock decisions for range layering.
 * Kept free of monitor/Sentry deps so watch helpers and unit tests stay light.
 */

export function evaluateTpTouch(args: {
  direction: string
  tps: number[]
  bid: number
  ask: number
}): { touched: boolean; triggerPrice: number | null; triggerSide: 'bid' | 'ask' | null } {
  const { direction, tps, bid, ask } = args
  const cleanTps = tps.filter(tp => Number.isFinite(tp) && tp > 0)
  if (!cleanTps.length) return { touched: false, triggerPrice: null, triggerSide: null }
  if (direction === 'buy') {
    const triggerPrice = Math.min(...cleanTps)
    return { touched: bid >= triggerPrice, triggerPrice, triggerSide: 'bid' }
  }
  if (direction === 'sell') {
    const triggerPrice = Math.max(...cleanTps)
    return { touched: ask <= triggerPrice, triggerPrice, triggerSide: 'ask' }
  }
  return { touched: false, triggerPrice: null, triggerSide: null }
}

/**
 * Decide whether a basket's layering must be locked when "layer till close"
 * is OFF. Independent triggers:
 *  1. live quote touches an open trade's TP (catches the touch in real time)
 *  2. the basket is PARTIALLY closed — some trades closed while others remain
 *     open. A broker-side TP fill closes its trades within seconds, so by the
 *     time the monitor scans, the touched TP rows are no longer 'open' and
 *     trigger (1) can never fire. A partial close is sticky evidence that a
 *     TP/CWE/partial close happened and survives that race.
 *  3. the basket is FULLY flat (openCount=0, closedCount>0) — mass closes can
 *     go 17→0 in one burst and never look "partial"; without this, virtual
 *     ladder rows keep firing and re-open Gold after the basket was closed.
 */
export function shouldLockBasketLayering(args: {
  direction: string
  openTps: number[]
  openCount: number
  closedCount: number
  bid: number
  ask: number
}): {
  lock: boolean
  reason: 'tp_touched' | 'basket_partially_closed' | 'basket_fully_closed' | null
  triggerPrice: number | null
  triggerSide: 'bid' | 'ask' | null
} {
  const { direction, openTps, openCount, closedCount, bid, ask } = args
  if (openCount <= 0) {
    if (closedCount > 0) {
      return { lock: true, reason: 'basket_fully_closed', triggerPrice: null, triggerSide: null }
    }
    return { lock: false, reason: null, triggerPrice: null, triggerSide: null }
  }

  const touch = evaluateTpTouch({ direction, tps: openTps, bid, ask })
  if (touch.touched) {
    return { lock: true, reason: 'tp_touched', triggerPrice: touch.triggerPrice, triggerSide: touch.triggerSide }
  }
  if (closedCount > 0) {
    return { lock: true, reason: 'basket_partially_closed', triggerPrice: null, triggerSide: null }
  }
  return { lock: false, reason: null, triggerPrice: null, triggerSide: null }
}
