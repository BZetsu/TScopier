import type { Leg } from './types'

/**
 * Collapse true full-lot clones (Luis teaser: N× same Buy/volume/comment).
 *
 * Must NOT touch granular multi/range legs. With `order_comments_enabled=false`,
 * those legs share empty comments and identical lot sizes — deduping them wipes
 * the immediate basket down to a single entry while virtual range legs remain.
 */
export function collapseIdenticalImmediateLegs(
  legs: Leg[],
  opts?: { baseLot?: number },
): { legs: Leg[]; collapsed: number } {
  const baseLot = Number(opts?.baseLot)
  const fullLotMin = Number.isFinite(baseLot) && baseLot > 0 ? baseLot * 0.85 : null

  const seen = new Set<string>()
  const out: Leg[] = []
  let collapsed = 0
  for (const leg of legs) {
    const a = leg.args
    const vol = Number(a.volume) || 0
    // Small/unknown lots are intentional multi/range granularity — keep every leg.
    if (fullLotMin == null || vol < fullLotMin) {
      out.push(leg)
      continue
    }
    const key = [
      String(a.operation ?? ''),
      String(a.symbol ?? ''),
      String(vol),
      String(a.comment ?? ''),
      String(Number(a.takeprofit) || 0),
      String(Number(a.stoploss) || 0),
    ].join('|')
    if (seen.has(key)) {
      collapsed += 1
      continue
    }
    seen.add(key)
    out.push(leg)
  }
  return { legs: out, collapsed }
}
