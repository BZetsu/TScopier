/**
 * Execution engine (Phase 2b) - opens basket legs PROTECTED at send and idempotently.
 *
 * Key properties (validated against the live contract):
 *  - SL/TP are attached in the OrderSend itself, so a leg is never naked even for
 *    a single round-trip (no separate-modify race).
 *  - Idempotent: one OpenedOrders snapshot is taken before the burst; a leg whose
 *    deterministic comment already exists is adopted (skipped), and fxClient.orderSend
 *    resolves ambiguous failures against that snapshot - so retries never duplicate.
 *  - Seeds the basket desired-state (single source of truth) with the entry SL/TP
 *    so the reconciler and ladder apply the same target to every future leg.
 *
 * Pure/testable: the planner (symbol resolution, lot sizing, clamping) runs upstream
 * and produces OpenLegPlan[]; persistence is an injected callback.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildOrderComment, type MtOperation } from './fxContract'
import type { FxClient, MtPlatform } from './fxClient'
import type { FxOpenOrder } from './fxContract'
import { setDesiredBasket } from './basketStore'

export type OpenLegPlan = {
  legIndex: number
  operation: MtOperation
  volume: number
  stopLoss?: number | null
  takeProfit?: number | null
}

export type OpenedLeg = {
  legIndex: number
  ticket: number
  volume: number
  price: number | null
  adopted: boolean // already existed (idempotent skip) or recovered from ambiguous send
}

export type FailedLeg = {
  legIndex: number
  reason: string
  retcode: number | null
}

export type OpenBasketArgs = {
  accountId: string
  platform: MtPlatform
  anchorSignalId: string
  brokerSymbol: string
  isBuy: boolean
  legs: OpenLegPlan[]
  /** Recorded onto trades + desired-state. */
  userId: string
  brokerAccountId: string
  channelId: string | null
  /** Desired SL/TP for the whole basket (seeds the single source of truth). */
  desiredStopLoss?: number | null
  desiredTpLevels?: number[]
  /** signal created_at for instruction ordering. */
  instructionAt?: string | null
  /** Supabase client - when provided, the entry SL/TP is seeded into desired-state. */
  supabase?: SupabaseClient
  /** Persist a freshly opened leg (insert into trades). Injected for testability. */
  recordTrade: (leg: { ticket: number; legIndex: number; volume: number; price: number | null; stopLoss: number | null; takeProfit: number | null }) => Promise<void>
}

export type OpenBasketResult = {
  opened: OpenedLeg[]
  failed: FailedLeg[]
  fullyOpened: boolean
}

export class ExecutionEngine {
  constructor(private fx: FxClient) {}

  async openBasket(args: OpenBasketArgs): Promise<OpenBasketResult> {
    const operation: MtOperation = args.isBuy ? 'Buy' : 'Sell'

    // One snapshot for the whole burst: powers both idempotent skip and ambiguous recovery.
    const snapshot = await this.fx.openedOrders(args.accountId, args.platform).catch(() => [] as FxOpenOrder[])
    const existingByComment = new Map<string, FxOpenOrder>()
    for (const o of snapshot) {
      if (o.comment) existingByComment.set(o.comment, o)
    }

    const opened: OpenedLeg[] = []
    const failed: FailedLeg[] = []

    for (const leg of args.legs) {
      const comment = buildOrderComment(args.anchorSignalId, leg.legIndex)

      // Idempotent skip: this leg already opened on a prior attempt.
      const already = existingByComment.get(comment)
      if (already) {
        opened.push({ legIndex: leg.legIndex, ticket: already.ticket, volume: already.volume, price: already.openPrice, adopted: true })
        await safeRecord(args, leg, already.ticket, already.volume, already.openPrice)
        continue
      }

      const result = await this.fx.orderSend(
        args.accountId,
        args.platform,
        {
          symbol: args.brokerSymbol,
          operation,
          volume: leg.volume,
          stopLoss: leg.stopLoss ?? undefined,
          takeProfit: leg.takeProfit ?? undefined,
          comment,
        },
        { anchorSignalId: args.anchorSignalId, legIndex: leg.legIndex, preSnapshot: snapshot },
      )

      if (result.ok && result.ticket) {
        const adopted = result.retcodeName === 'DONE' && result.message.includes('adopted')
        opened.push({ legIndex: leg.legIndex, ticket: result.ticket, volume: result.volume ?? leg.volume, price: result.price, adopted })
        await safeRecord(args, leg, result.ticket, result.volume ?? leg.volume, result.price)
      } else {
        failed.push({ legIndex: leg.legIndex, reason: result.message, retcode: result.retcode })
      }
    }

    // Seed the desired-state (single source of truth) so reconciler + ladder agree.
    if ((args.desiredStopLoss != null && args.desiredStopLoss > 0) || (args.desiredTpLevels?.length ?? 0) > 0) {
      await seedDesired(args).catch(() => {})
    }

    return { opened, failed, fullyOpened: failed.length === 0 && opened.length === args.legs.length }
  }
}

async function safeRecord(
  args: OpenBasketArgs,
  leg: OpenLegPlan,
  ticket: number,
  volume: number,
  price: number | null,
): Promise<void> {
  try {
    await args.recordTrade({
      ticket,
      legIndex: leg.legIndex,
      volume,
      price,
      stopLoss: leg.stopLoss ?? null,
      takeProfit: leg.takeProfit ?? null,
    })
  } catch (err) {
    // A failed trades-insert must not block the burst; the reconciler/orphan adoption
    // will pick up an opened-but-unrecorded leg from the broker snapshot.
    console.warn(`[executionEngine] recordTrade failed ticket=${ticket} leg=${leg.legIndex}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function seedDesired(args: OpenBasketArgs): Promise<void> {
  if (!args.supabase) return
  await setDesiredBasket(args.supabase, {
    userId: args.userId,
    brokerAccountId: args.brokerAccountId,
    anchorSignalId: args.anchorSignalId,
    channelId: args.channelId,
    symbol: args.brokerSymbol,
    stoploss: args.desiredStopLoss ?? null,
    tpLevels: args.desiredTpLevels ?? null,
    source: 'entry',
    instructionAt: args.instructionAt ?? null,
  })
}
