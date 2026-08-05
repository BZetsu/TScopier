/**
 * Detect when a Broker Pending limit has filled on the broker.
 *
 * MT5 / bridge APIs often replace the pending ticket with a new market ticket.
 * Relying only on ClosedOrders for the original ticket misses those fills.
 */

import {
  findClosedRowForTicket,
  findOpenedRowByTicket,
  isLikelyMarketPositionRow,
  isPendingEntryRow,
  rawOrderTicket,
} from './signalEntryPendingHelpers'
import { symbolsCompatibleForBasket } from './basketModFollowUp'

export type BrokerPendingFillLeg = {
  signal_id: string
  symbol: string
  ticket: string | null
  comment: string | null
  trigger_price: number
  volume: number
}

export type BrokerPendingFillHit = {
  fillPrice: number
  positionTicket: string | null
  matchedBy: 'same_ticket' | 'comment' | 'closed_ticket'
}

export type BrokerPendingOpenedDecision =
  | { kind: 'still_pending' }
  | { kind: 'filled'; hit: BrokerPendingFillHit }
  | { kind: 'absent' }

function extractOpenPrice(raw: Record<string, unknown>): number | null {
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }
  const px = num(raw.openPrice ?? raw.OpenPrice ?? raw.price ?? raw.Price ?? raw.priceOpen ?? raw.PriceOpen)
  return px != null && px > 0 ? px : null
}

function readOpenedComment(row: unknown): string {
  if (row == null || typeof row !== 'object') return ''
  const o = row as Record<string, unknown>
  const c = o.comment ?? o.Comment
  return typeof c === 'string' ? c : ''
}

function readOpenedVolume(row: Record<string, unknown>): number | null {
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }
  const v = num(row.lots ?? row.Lots ?? row.volume ?? row.Volume ?? row.lotSize)
  return v != null && v > 0 ? v : null
}

function priceNear(a: number, b: number, tolRatio = 0.002): boolean {
  if (!(a > 0) || !(b > 0)) return false
  const tol = Math.max(b * tolRatio, b * 1e-6)
  return Math.abs(a - b) <= tol
}

function volumeNear(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false
  return Math.abs(a - b) <= Math.max(0.01, b * 0.05)
}

/**
 * Prefer a live market position ticket (MT5 often changes ticket on pending fill).
 * Comment match is authoritative; signal-only match requires volume + price proximity
 * so immediate market legs in the same basket are not mistaken for this fill.
 */
export function resolveFilledPositionTicket(
  opened: unknown[],
  leg: BrokerPendingFillLeg,
  preferredTicket: number | null,
  excludeTickets?: ReadonlySet<string>,
): { ticket: string | null; fillPrice: number | null; matchedBy: 'same_ticket' | 'comment' | 'none' } {
  if (preferredTicket != null && preferredTicket > 0) {
    const hit = findOpenedRowByTicket(opened, preferredTicket)
    if (hit && isLikelyMarketPositionRow(hit)) {
      return {
        ticket: String(preferredTicket),
        fillPrice: extractOpenPrice(hit),
        matchedBy: 'same_ticket',
      }
    }
  }

  const signalNeedle = leg.signal_id.slice(0, 8)
  const commentNeedle = (leg.comment ?? '').trim()
  let best: { ticket: string; fillPrice: number | null; score: number } | null = null

  for (const raw of opened) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (!isLikelyMarketPositionRow(o)) continue
    const sym = String(o.symbol ?? o.Symbol ?? '')
    if (sym && !symbolsCompatibleForBasket(leg.symbol, sym)) continue
    const ticket = rawOrderTicket(o)
    if (!(ticket > 0)) continue
    const ticketStr = String(ticket)
    if (excludeTickets?.has(ticketStr)) continue

    const comment = readOpenedComment(raw)
    const matchesComment = commentNeedle.length > 0 && comment.includes(commentNeedle)
    const matchesSignal = comment.includes(signalNeedle) || comment.includes(leg.signal_id)
    if (!matchesComment && !matchesSignal) continue

    const fillPrice = extractOpenPrice(o)
    const vol = readOpenedVolume(o)
    let score = 0
    if (matchesComment) score += 100
    else if (matchesSignal) {
      // Loose signal match only if this looks like the filled limit.
      if (fillPrice == null || !priceNear(fillPrice, leg.trigger_price)) continue
      if (vol == null || !volumeNear(vol, leg.volume)) continue
      score += 10
    }
    if (fillPrice != null && priceNear(fillPrice, leg.trigger_price)) score += 20
    if (vol != null && volumeNear(vol, leg.volume)) score += 10

    if (!best || score > best.score) {
      best = { ticket: ticketStr, fillPrice, score }
    }
  }

  if (best && best.score >= 10) {
    return { ticket: best.ticket, fillPrice: best.fillPrice, matchedBy: 'comment' }
  }

  return { ticket: null, fillPrice: null, matchedBy: 'none' }
}

/** Classify a broker_pending row against a single /OpenedOrders snapshot. */
export function decideBrokerPendingOpenedState(
  opened: unknown[],
  leg: BrokerPendingFillLeg,
  excludeTickets?: ReadonlySet<string>,
): BrokerPendingOpenedDecision {
  const ticket = Number(leg.ticket)
  if (!Number.isFinite(ticket) || ticket <= 0) return { kind: 'absent' }

  const hit = findOpenedRowByTicket(opened, ticket)
  if (hit) {
    if (isPendingEntryRow(hit)) return { kind: 'still_pending' }
    if (isLikelyMarketPositionRow(hit)) {
      const px = extractOpenPrice(hit) ?? leg.trigger_price
      return {
        kind: 'filled',
        hit: {
          fillPrice: px,
          positionTicket: String(ticket),
          matchedBy: 'same_ticket',
        },
      }
    }
    // Ambiguous same-ticket row — keep watching.
    return { kind: 'still_pending' }
  }

  const resolved = resolveFilledPositionTicket(opened, leg, ticket, excludeTickets)
  if (resolved.matchedBy !== 'none' && resolved.ticket) {
    return {
      kind: 'filled',
      hit: {
        fillPrice: resolved.fillPrice ?? leg.trigger_price,
        positionTicket: resolved.ticket,
        matchedBy: resolved.matchedBy === 'same_ticket' ? 'same_ticket' : 'comment',
      },
    }
  }

  return { kind: 'absent' }
}

/** When the pending ticket is gone, try ClosedOrders + OpenedOrders comment match. */
export function decideBrokerPendingClosedFill(
  opened: unknown[],
  closed: unknown[],
  leg: BrokerPendingFillLeg,
  excludeTickets?: ReadonlySet<string>,
): BrokerPendingFillHit | null {
  const ticket = Number(leg.ticket)
  if (!Number.isFinite(ticket) || ticket <= 0) return null

  const closedHit = findClosedRowForTicket(closed, ticket)
  if (!closedHit) {
    // ClosedOrders may lag; still accept a strong OpenedOrders comment match.
    const openedOnly = decideBrokerPendingOpenedState(opened, leg, excludeTickets)
    if (openedOnly.kind === 'filled') return openedOnly.hit
    return null
  }

  const resolved = resolveFilledPositionTicket(opened, leg, ticket, excludeTickets)
  const fillPrice = resolved.fillPrice
    ?? (typeof closedHit.openPrice === 'number' && closedHit.openPrice > 0
      ? closedHit.openPrice
      : null)
    ?? leg.trigger_price

  return {
    fillPrice,
    positionTicket: resolved.ticket
      ?? (closedHit.brokerTicket != null ? String(closedHit.brokerTicket) : String(ticket)),
    matchedBy: resolved.matchedBy === 'comment' ? 'comment' : 'closed_ticket',
  }
}
