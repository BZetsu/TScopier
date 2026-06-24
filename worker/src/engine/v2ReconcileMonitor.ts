/**
 * v2 reconcile monitor (Phase 5/6, management-first cutover).
 *
 * ONE loop that drives every open basket on a v2-flagged broker toward its desired
 * state, replacing the competing v1 appliers (basketSlTpReconcileMonitor jobs,
 * channelStopApply, slTpRefresh, live mgmt modifies) for those brokers. Because only
 * this loop touches v2 baskets, the "SL reverts / flip-flops" class of bug - caused by
 * multiple appliers racing with stale data - cannot happen.
 *
 * Desired state is the instruction-ordered `basket_sl_tp_targets` row (written by the
 * existing management path). The loop:
 *   desired + open legs (trades) + broker snapshot (fxClient.OpenedOrders)
 *   -> buildDesiredLegTargets (pure) -> computeReconcileActions (pure)
 *   -> applyReconcileActions (strict fxClient, SL-first fallback)
 *
 * Safety: only drifted legs are modified (idempotent no-op when synced); present TPs
 * are never repainted (kept as-is), so a hit-then-retrace can't re-arm a taken TP;
 * vanished legs are marked closed in the DB (no broker action); orphan adoption is
 * log-only on the first run.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FxClient, getFxClient, type MtPlatform } from './fxClient'
import type { FxOpenOrder } from './fxContract'
import {
  applyReconcileActions,
  computeReconcileActions,
  type DesiredLegTarget,
} from './reconciler'
import { loadDesiredBasket, resolveLegTargets, type DesiredBasket } from './basketStore'
import { type BasketOpenLeg, closeStaleOpenTrades, loadOpenBasketLegs } from '../basketSlTpReconcile'
import { brokerSessionUuid } from '../tradeExecutor/helpers'
import { hasFxsocketConfigured } from '../fxsocketClient'
import { isV2 } from './executionMode'

const TICK_MS = Math.min(60_000, Math.max(1_000, Number(process.env.V2_RECONCILE_TICK_MS ?? 4_000)))

function legTicket(leg: BasketOpenLeg): number | null {
  const t = Number(leg.metaapi_order_id)
  return Number.isFinite(t) && t > 0 ? t : null
}

function deepestTp(tpLevels: number[], isBuy: boolean): number | null {
  if (!tpLevels.length) return null
  // Deepest = farthest target: highest for buy, lowest for sell.
  return isBuy ? Math.max(...tpLevels) : Math.min(...tpLevels)
}

/**
 * Pure: compute the per-leg SL/TP the basket SHOULD have right now.
 *  - SL: the desired-state SL (honoring a newer per-leg auto-breakeven), applied to
 *    every leg, so an instruction-ordered adjust/BE can never be reverted.
 *  - TP: keep the leg's existing broker TP (never repaint); only fill a naked leg with
 *    the deepest ladder TP so it has a protective target.
 */
export function buildDesiredLegTargets(args: {
  legs: BasketOpenLeg[]
  snapshot: FxOpenOrder[]
  desired: DesiredBasket | null
  isBuy: boolean
  anchorSl?: number | null
  anchorTps?: number[]
}): DesiredLegTarget[] {
  const byTicket = new Map<number, FxOpenOrder>()
  for (const o of args.snapshot) byTicket.set(o.ticket, o)

  const out: DesiredLegTarget[] = []
  for (const leg of args.legs) {
    const ticket = legTicket(leg)
    if (ticket == null) continue
    const o = byTicket.get(ticket)
    if (!o) continue // not at broker -> reconciler closedTickets handles it

    const resolved = resolveLegTargets({
      desired: args.desired,
      autoBeAt: leg.auto_be_applied_at ?? null,
      autoBeSl: leg.auto_be_applied_at ? leg.sl ?? null : null,
      anchorSl: args.anchorSl ?? leg.sl ?? null,
      anchorTps: args.anchorTps ?? (leg.tp != null && leg.tp > 0 ? [leg.tp] : []),
      isBuy: args.isBuy,
    })

    const existingTp = o.takeProfit != null && o.takeProfit > 0 ? o.takeProfit : null
    const fillTp = existingTp ?? deepestTp(resolved.tpLevels, args.isBuy)

    out.push({ ticket, stoploss: resolved.stoploss, takeProfit: fillTp })
  }
  return out
}

type BasketKey = { brokerAccountId: string; anchorSignalId: string; symbol: string; isBuy: boolean }

type BrokerSession = { uuid: string; platform: MtPlatform; userId: string | null }

/** The single management-first reconcile loop for v2 brokers. */
export class V2ReconcileMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private fx: FxClient

  constructor(private readonly supabase: SupabaseClient, fx?: FxClient) {
    this.fx = fx ?? getFxClient()
  }

  start(): void {
    if (this.timer) return
    if (!hasFxsocketConfigured() && !process.env.FXSOCKET_API_KEY) {
      console.warn('[v2ReconcileMonitor] FxSocket not configured — disabled')
      return
    }
    this.timer = setInterval(() => void this.runTick(), TICK_MS)
    console.log(`[v2ReconcileMonitor] started tick=${TICK_MS}ms (v2 brokers only)`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async runTick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.tick()
    } catch (err) {
      console.warn(`[v2ReconcileMonitor] tick failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.ticking = false
    }
  }

  /** Enumerate v2 baskets, then reconcile each. */
  async tick(): Promise<{ baskets: number; modified: number; closed: number }> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('broker_account_id,signal_id,symbol,direction')
      .eq('status', 'open')
      .limit(5000)
    if (error || !data) return { baskets: 0, modified: 0, closed: 0 }

    const baskets = new Map<string, BasketKey>()
    for (const r of data as Array<{ broker_account_id: string; signal_id: string; symbol: string; direction: string }>) {
      if (!r.broker_account_id || !r.signal_id) continue
      if (!isV2({ brokerAccountId: r.broker_account_id })) continue
      const key = `${r.broker_account_id}|${r.signal_id}|${r.symbol}`
      if (!baskets.has(key)) {
        baskets.set(key, {
          brokerAccountId: r.broker_account_id,
          anchorSignalId: r.signal_id,
          symbol: r.symbol,
          isBuy: String(r.direction).toLowerCase().startsWith('buy'),
        })
      }
    }

    const sessions = await this.loadSessions([...baskets.values()].map(b => b.brokerAccountId))
    let modified = 0
    let closed = 0
    for (const basket of baskets.values()) {
      const session = sessions.get(basket.brokerAccountId)
      if (!session) continue
      const res = await this.reconcileBasket(basket, session).catch(() => null)
      if (res) { modified += res.modified; closed += res.closed }
    }
    return { baskets: baskets.size, modified, closed }
  }

  private async loadSessions(brokerIds: string[]): Promise<Map<string, BrokerSession>> {
    const out = new Map<string, BrokerSession>()
    const unique = [...new Set(brokerIds)]
    if (!unique.length) return out
    const { data } = await this.supabase
      .from('broker_accounts')
      .select('id,user_id,fxsocket_account_id,metaapi_account_id,platform')
      .in('id', unique)
    for (const b of (data ?? []) as Array<{ id: string; user_id?: string; fxsocket_account_id?: string; metaapi_account_id?: string; platform?: string }>) {
      const uuid = brokerSessionUuid(b)
      if (!uuid) continue
      const platform: MtPlatform = String(b.platform).toUpperCase() === 'MT4' ? 'MT4' : 'MT5'
      out.set(b.id, { uuid, platform, userId: b.user_id ?? null })
    }
    return out
  }

  private async reconcileBasket(basket: BasketKey, session: BrokerSession): Promise<{ modified: number; closed: number }> {
    const [legs, desired] = await Promise.all([
      loadOpenBasketLegs(this.supabase, basket.brokerAccountId, basket.anchorSignalId, basket.symbol),
      loadDesiredBasket(this.supabase, basket.brokerAccountId, basket.anchorSignalId),
    ])
    if (!legs.length) return { modified: 0, closed: 0 }

    // SAFETY: the broker snapshot is the source of truth for "is this leg still open?".
    // If the fetch FAILS we must NOT proceed - an empty list would be read as
    // "every leg vanished" and wrongly mark all legs closed in the DB. Abort instead.
    let snapshot: FxOpenOrder[]
    try {
      snapshot = await this.fx.openedOrders(session.uuid, session.platform)
    } catch (err) {
      console.warn(`[v2ReconcileMonitor] snapshot failed broker=${basket.brokerAccountId} anchor=${basket.anchorSignalId} — skipping (no close): ${err instanceof Error ? err.message : String(err)}`)
      return { modified: 0, closed: 0 }
    }

    const desiredTargets = buildDesiredLegTargets({ legs, snapshot, desired, isBuy: basket.isBuy })
    const trackedTickets = legs.map(legTicket).filter((t): t is number => t != null)

    const actions = computeReconcileActions({
      desired: desiredTargets,
      openOrders: snapshot,
      trackedTickets,
    })
    // Orphan adoption is log-only on the first management-first run.
    const orphanCount = actions.adopt.length
    actions.adopt = []

    // SAFETY: never mass-close a basket off an empty snapshot. A disconnected
    // FxSocket session can return an empty (but successful) OpenedOrders list; that
    // must not be read as "all legs closed". Only honor closes when the snapshot
    // actually shows other open orders (a real account picture).
    if (snapshot.length === 0 && actions.closedTickets.length > 0) {
      console.warn(`[v2ReconcileMonitor] empty snapshot with ${actions.closedTickets.length} tracked legs broker=${basket.brokerAccountId} anchor=${basket.anchorSignalId} — deferring close (suspected disconnect)`)
      actions.closedTickets = []
    }

    const ticketToTradeId = new Map<number, string>()
    for (const leg of legs) {
      const t = legTicket(leg)
      if (t != null) ticketToTradeId.set(t, leg.id)
    }

    const result = await applyReconcileActions(
      {
        fx: this.fx,
        accountId: session.uuid,
        platform: session.platform,
        markClosed: async ticket => {
          const id = ticketToTradeId.get(ticket)
          if (id) await closeStaleOpenTrades(this.supabase, [id])
        },
        adoptOrphan: async () => {},
      },
      actions,
    )

    if (result.modified > 0 || result.closed > 0 || result.modifyFailed > 0 || orphanCount > 0) {
      await this.logTick(basket, session.userId, { ...result, legs: legs.length, orphanCount })
    }
    return { modified: result.modified, closed: result.closed }
  }

  private async logTick(
    basket: BasketKey,
    userId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!userId) return
    try {
      await this.supabase.from('trade_execution_logs').insert({
        user_id: userId,
        signal_id: basket.anchorSignalId,
        broker_account_id: basket.brokerAccountId,
        action: 'v2_reconcile_tick',
        status: (payload.modifyFailed as number) > 0 ? 'failed' : 'success',
        request_payload: {
          anchor_signal_id: basket.anchorSignalId,
          symbol: basket.symbol,
          ...payload,
        } as unknown as Record<string, unknown>,
      })
    } catch { /* best-effort */ }
  }
}
