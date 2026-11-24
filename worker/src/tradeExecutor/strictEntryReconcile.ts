/**
 * Broker check for a strict-entry pending order (BuyLimit/SellLimit) whose
 * OrderSend call timed out.
 *
 * Why this exists: `placeOneStrictPending` only writes its `trades` row and its
 * `signal_entry_pending_orders` row AFTER `api.orderSend` returns successfully.
 * When the ack is lost, both inserts are skipped — yet the order may be live at
 * the broker. Nothing then tracks it: `signalEntryPendingMonitor` needs a
 * `signal_entry_pending_orders` row, and `orphanPositionMonitor` deliberately
 * rejects resting pendings (`isLikelyMarketPositionRow`). The result is a live
 * resting limit order nobody will ever cancel or fill-track.
 *
 * What this does: reads /OpenedOrders and, when exactly one order matches the
 * intent, hands back its ticket so the caller can persist the two rows the
 * normal success path would have written. From there the existing
 * `signalEntryPendingMonitor` takes over unchanged — it keeps a resting
 * pending waiting and promotes a filled one to `open` on its next tick, so
 * there is no second fill-detection path to keep in step.
 *
 * Conservative by construction, mirroring `reconcileUnknownSend`:
 *   - symbol + side + comment must all match, the comment by PREFIX so a
 *     bridge-truncated comment still identifies our own order while a sibling
 *     leg whose `:tpN` survived the cut is rejected;
 *   - the lot size must agree when the broker reports one, which is what
 *     separates sibling legs once truncation has erased their `:tpN`;
 *   - exactly one match adopts; zero or many are inconclusive;
 *   - a pending is NEVER reported absent — a resting order may simply be
 *     missing from the snapshot, so "absent" would invite a duplicate resend.
 *
 * On any failure to persist a found order this re-reads /OpenedOrders and rolls
 * back AT THE BROKER only while the order is still resting (mirroring the
 * normal path's `api.orderClose`, and the same fail-safe
 * `tradesPendingCancel.ts` uses: a filled ticket must never be cancelled, and
 * on FXSocket `orderCancel` IS `orderClose`). A fill cannot be cancelled, so
 * its ticket is always carried into the audit row instead.
 *
 * This lives in its own file rather than in `reconcileUnknownSend.ts` so that
 * the market-order resolver stays byte-identical to Martins's `14f1aaf6`
 * (opened-position dedupe). See docs/audit-2026-11-11/. Only `normSymbol` and
 * `numberOrNull` remain knowingly duplicated — exporting them would mean
 * editing that file, and no exported equivalent exists elsewhere. The side
 * reader deliberately DELEGATES to the exported `directionOf` rather than
 * copying its key list, adding only the numeric kinds that reader omits.
 */
import type { FxsocketBrokerClient, MtOperation } from '../fxsocketClient'
import { isOrderOpTimedOutMessage } from '../fxsocketClient'
import { autoManagementTradeSnapshot } from '../autoManagement'
import { clampOrderStops } from './helpers'
import { normalizeBrokerTradeTicket } from '../brokerTradeTicket'
import { cancelPendingOrderAtBroker } from '../pendingOrderCancel'
import { writeExecutionLog } from '../observability/executionLog'
import { isDuplicateKeyError, renewSignalBrokerDispatchClaim, SIGNAL_DISPATCH_CLAIM_LEASE_MS } from './signalBrokerDispatchClaim'
import {
  findOpenedRowByTicket,
  isLikelyMarketPositionRow,
  isPendingEntryRow,
  rawNumericOrderKind,
  rawOrderTicket,
} from '../signalEntryPendingHelpers'
import { parseTscopierComment } from '../tscopierComment'
import { dedupeOpenedMarketPositions } from '../livePositionIdentity'
import { directionOf } from './reconcileUnknownSend'
import type { TradeExecutorContext } from './context'
import type { PreparedEntry } from './entryPrepare'

/** What the caller sent, plus enough context to persist an adopted order. */
export type StrictPendingIntent = {
  ctx: TradeExecutorContext
  prep: PreparedEntry
  entryPx: number
  pendingOp: MtOperation
  expiresAt: string | null
  digits: number
  volume: number
  stoploss: number
  takeprofit: number
  slippage: number
  comment: string
  expertID: number
  partialTpPlan: unknown
  nextTpIndex: number
}

export type StrictPendingReconcile =
  | {
      status: 'adopted'
      ticket: number
      /** Broker-reported price when the row carries one; null otherwise. */
      openPrice: number | null
      stopLoss: number | null
      takeProfit: number | null
      lots: number | null
      /** True when the order already became a market position. */
      filled: boolean
    }
  | { status: 'inconclusive'; reason: string }

export type AdoptOutcome =
  | { ok: true }
  | { ok: false; ticket: number; cancelled: boolean; alreadyTracked?: boolean }

/**
 * Lower bound of `trades_broker_order_unique_idx`, which is a PARTIAL index
 * (`WHERE … AND created_at >= '2026-08-05'`). Mirroring its predicate keeps the
 * ownership lookup index-backed instead of scanning the ~92k-row table, and
 * only rows the index covers can raise a conflict anyway.
 */
const TRADES_CONFLICT_SINCE = '2026-08-05T00:00:00.000Z'

function normSymbol(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Ticket the monitor will be able to read back.
 *
 * Uses the monitor's own reader rather than a wider key list: adopting a
 * `positionTicket` the monitor cannot find would make it report the order
 * missing and cancel a live trade six ticks later. Rows whose ticket is only
 * expressible through keys the monitor does not read are simply not adopted.
 */
function trackableTicket(row: Record<string, unknown>): number {
  return rawOrderTicket(row)
}

/**
 * Trackable ticket for a deduped fill.
 *
 * The twin-collapse deliberately prefers the member carrying a position id, and
 * that member's row often has no `ticket` field at all — so `rawOrderTicket`
 * reads 0 from the very row we were handed. Falling back to the cluster's
 * merged `identities` lets us pick the twin the monitor CAN read, without
 * widening the key list (which would reintroduce the mismatch this guards).
 * Returns 0 when no identity is readable, so the order is not adopted rather
 * than adopted untrackably.
 */
function trackableTicketFor(
  position: { row: Record<string, unknown>; identities: Iterable<number> },
  openedOrders: unknown[],
): number {
  const direct = rawOrderTicket(position.row)
  if (direct > 0) return direct
  for (const identity of position.identities) {
    if (!Number.isFinite(identity) || identity <= 0) continue
    for (const raw of openedOrders) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      if (rawOrderTicket(raw as Record<string, unknown>) === identity) return identity
    }
  }
  return 0
}

/**
 * Side of a broker row, resting pendings included.
 *
 * Delegates the operation-string keys to the exported market-row reader
 * instead of re-listing them: two copies of the same key list is exactly how
 * the two readers drift apart.
 *
 * The numeric fallback still has to be repeated here, and must cover kinds
 * 0/1 as well as 2-5: `directionOf` reads the kind only from `type`/`Type`,
 * while `rawNumericOrderKind` also reads `orderType`/`cmd`. Dropping 0/1
 * made this reader return null for rows like `{ orderType: 0 }` that the
 * previous implementation matched (brute-forced: 3040 combinations regressed,
 * 0 lost with 0/1 restored).
 *
 * A blank `type` is skipped before delegating: `Number('')` is 0, so the
 * shared reader would call a side-less row "buy".
 */
function orderSideOf(row: Record<string, unknown>): 'buy' | 'sell' | null {
  // Neutralise a blank `type`/`Type` rather than skipping delegation: the
  // shared reader does `Number(row.type ?? row.Type)` and `Number('')` is 0,
  // which would call a side-less row "buy". Dropping only the blank fields
  // keeps its word-side logic intact, so a row like
  // `{ type: '', orderType: 'SellLimit' }` still resolves to "sell".
  const rawKind = row.type ?? row.Type
  const blankKind = typeof rawKind === 'string' && rawKind.trim() === ''
  const src = blankKind ? { ...row, type: undefined, Type: undefined } : row

  const direct = directionOf(src)
  if (direct) return direct

  const kind = rawNumericOrderKind(src)
  if (kind === 0 || kind === 2 || kind === 4) return 'buy'
  if (kind === 1 || kind === 3 || kind === 5) return 'sell'
  return null
}

function lotsMatch(rowLots: number | null, intentVolume: number, lotStep?: number): boolean {
  if (rowLots == null || !(intentVolume > 0)) return true
  const step = Number(lotStep)
  // Half a legal step absorbs a broker's own rounding while still separating
  // any two genuinely different legs (they differ by at least one full step).
  const tolerance = Number.isFinite(step) && step > 0
    ? step / 2
    : Math.max(1e-9, Math.abs(intentVolume) * 1e-6)
  return Math.abs(rowLots - intentVolume) <= tolerance
}

/**
 * Pure matcher over one /OpenedOrders snapshot. Split out so it can be tested
 * without a broker client.
 */
export function resolveStrictPendingFromOrders(
  openedOrders: unknown[],
  intent: {
    symbol: string
    operation: string
    comment?: string | null
    volume?: number
    lotStep?: number
  },
): StrictPendingReconcile {
  if (!Array.isArray(openedOrders)) {
    return { status: 'inconclusive', reason: 'broker returned an unreadable order list' }
  }

  const symbol = normSymbol(intent.symbol)
  const op = intent.operation.toLowerCase()
  const wantDir: 'buy' | 'sell' | null = op.includes('buy') ? 'buy' : op.includes('sell') ? 'sell' : null
  const parsed = parseTscopierComment(intent.comment)
  const id8 = parsed?.signalIdPrefix ?? null
  const intentComment = String(intent.comment ?? '').toLowerCase()
  const intentVolume = Number(intent.volume) || 0

  const matches = (row: Record<string, unknown>): boolean => {
    if (normSymbol(row.symbol ?? row.Symbol) !== symbol) return false
    if (wantDir != null && orderSideOf(row) !== wantDir) return false

    const rowComment = String(row.comment ?? row.Comment ?? '').toLowerCase()
    if (!rowComment) return false
    if (id8 && !rowComment.includes(id8)) return false

    // Compare by PREFIX, not by segment. The bridge truncates order comments
    // (31 chars on MT4) and `:tpN` sits past that cut once the channel slug
    // reaches 9 characters — `UniCopier:gold-room:<id8>:tp1:strictEntry`
    // truncates to `...<id8>:tp`, losing the digit entirely. A segment check
    // then rejects OUR OWN order, so the live resting order is never adopted:
    // the exact defect this module exists to remove. Prefix matching accepts
    // our own comment whole or truncated, while a sibling leg whose `:tpN`
    // did survive diverges and is still rejected. Once truncation erases the
    // digit the legs become comment-identical and the lot-size check below is
    // what separates them.
    if (!intentComment.startsWith(rowComment)) return false

    if (!lotsMatch(
      numberOrNull(row.lots ?? row.Lots ?? row.volume ?? row.Volume),
      intentVolume,
      intent.lotStep,
    )) {
      return false
    }
    return true
  }

  const distinct = new Map<number, { row: Record<string, unknown>; filled: boolean }>()

  // Resting pendings first. `dedupeOpenedMarketPositions` only keeps market
  // positions, so without this pass a live resting order is invisible here.
  for (const raw of openedOrders) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (!isPendingEntryRow(row)) continue
    if (!matches(row)) continue
    const ticket = trackableTicket(row)
    if (ticket > 0) distinct.set(ticket, { row, filled: false })
  }

  // Then fills, collapsed so one position seen as both order and position row
  // counts once (same twin-dedupe the market path relies on).
  for (const position of dedupeOpenedMarketPositions(openedOrders)) {
    const row = position.row
    if (!isLikelyMarketPositionRow(row)) continue
    if (!matches(row)) continue
    const ticket = trackableTicketFor(position, openedOrders)
    if (ticket > 0 && !distinct.has(ticket)) distinct.set(ticket, { row, filled: true })
  }

  if (distinct.size > 1) {
    return { status: 'inconclusive', reason: 'more than one live order matches' }
  }
  if (distinct.size === 1) {
    const [ticket, hit] = [...distinct.entries()][0]!
    const row = hit.row
    return {
      status: 'adopted',
      ticket,
      openPrice: numberOrNull(row.openPrice ?? row.OpenPrice ?? row.price ?? row.Price),
      stopLoss: numberOrNull(row.stopLoss ?? row.StopLoss ?? row.sl ?? row.SL),
      takeProfit: numberOrNull(row.takeProfit ?? row.TakeProfit ?? row.tp ?? row.TP),
      lots: numberOrNull(row.lots ?? row.Lots ?? row.volume ?? row.Volume),
      filled: hit.filled,
    }
  }

  // Never "absent" for a pending: absence from this snapshot does not prove the
  // order never reached the broker, and reporting it as absent would let a
  // caller resend and duplicate the customer's entry.
  return { status: 'inconclusive', reason: 'no matching order found' }
}

/** Reads /OpenedOrders and resolves the intent against it. */
export async function reconcileStrictPending(
  api: FxsocketBrokerClient,
  sessionId: string,
  intent: {
    symbol: string
    operation: string
    comment?: string | null
    volume?: number
    lotStep?: number
  },
): Promise<StrictPendingReconcile> {
  let openedOrders: unknown[]
  try {
    openedOrders = (await api.openedOrders(sessionId)) ?? []
  } catch (err) {
    return {
      status: 'inconclusive',
      reason: `broker read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return resolveStrictPendingFromOrders(openedOrders, intent)
}

/**
 * Persist the two rows the normal success path would have written, so the
 * existing `signalEntryPendingMonitor` owns the order from here on.
 *
 * The rows are always written as `pending` / `broker_pending` even when the
 * broker report says the order already filled: the monitor reads the ticket
 * back from /OpenedOrders on its next tick and promotes it via
 * `markSignalEntryFilled`, which is also what sets up the partial-TP legs.
 * Writing `open` here would skip that setup.
 *
 * Every exit goes through `fail()`: the Supabase client rejects on a network
 * error rather than resolving with `{ error }`, and that same flaky network is
 * what produced the OrderSend timeout in the first place. An escaping throw
 * would skip the caller's audit row and abort the remaining percent-split legs.
 */
export async function adoptTimedOutStrictPending(
  intent: StrictPendingIntent,
  found: Extract<StrictPendingReconcile, { status: 'adopted' }>,
): Promise<AdoptOutcome> {
  const { ctx, prep } = intent
  const { signal, broker, uuid, symbol } = prep
  const api = prep.api
  if (!api) return { ok: false, ticket: found.ticket, cancelled: false }

  const tradeTicket = normalizeBrokerTradeTicket(broker.provider, found.ticket)
  if (tradeTicket == null) {
    console.error(
      `[tradeExecutor] strict pending reconcile returned an invalid ticket`
      + ` signal=${signal.id} broker=${broker.id} ticket=${found.ticket}`,
    )
    return { ok: false, ticket: found.ticket, cancelled: false }
  }

  // Ownership pre-check. The matcher can only compare comments, and once MT4
  // truncation erases a leg's `:tpN` two legs of one signal become
  // comment-identical — so this can match a sibling leg's ALREADY-TRACKED
  // order. Adopting that would hit `trades_broker_order_unique_idx`, and the
  // resulting insert failure would flow into `fail()` and CANCEL a live order
  // that another row already manages. Never adopt, and never cancel, a ticket
  // that already has a row.
  //
  // The predicate mirrors that partial index (`created_at >= 2026-08-05`) so
  // the lookup stays index-backed rather than scanning ~92k trades; only rows
  // the index covers can conflict anyway.
  const { count: ownedCount, error: ownedErr } = await ctx.supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('broker_account_id', broker.id)
    .eq('metaapi_order_id', tradeTicket)
    .gte('created_at', TRADES_CONFLICT_SINCE)
  if (ownedErr) {
    // Cannot verify ownership, so cancelling could destroy another row's live
    // order — leave the broker alone. Deliberately NOT flagged alreadyTracked:
    // that flag makes the caller emit a bare `inconclusive`, which would drop
    // the ticket from `error_message`, and the ticket is the only record of a
    // possibly-live order (Martins's request_payload block is frozen and cannot
    // carry it either). Returning plain not-recorded puts `order #N` in the log.
    console.error(
      `[tradeExecutor] strict pending ownership check FAILED signal=${signal.id}`
      + ` broker=${broker.id} ticket=${tradeTicket}: ${ownedErr.message}`
      + ' — not adopting, not cancelling',
    )
    return { ok: false, ticket: found.ticket, cancelled: false }
  }
  if ((ownedCount ?? 0) > 0) {
    console.warn(
      `[tradeExecutor] strict pending ticket ${tradeTicket} already tracked`
      + ` signal=${signal.id} broker=${broker.id} — not adopting, not cancelling`,
    )
    return { ok: false, ticket: found.ticket, cancelled: false, alreadyTracked: true }
  }

  /** True once both rows exist — after that a rollback would delete a good order. */
  let persisted = false

  const fail = async (reason: string): Promise<AdoptOutcome> => {
    if (persisted) return { ok: true }
    let cancelled = false
    if (!found.filled) {
      // Re-read before cancelling. `found.filled` is a snapshot taken before
      // the two DB writes, so it can be stale by the time we get here — and on
      // FXSocket `orderCancel` IS `orderClose`, so cancelling a fill would
      // close the customer's just-opened position and label it "cancelled".
      // Same fail-safe as tradesPendingCancel.ts: only cancel what a fresh
      // snapshot still shows as a resting pending; an unreadable snapshot means
      // do not cancel (the ticket is in the audit row either way).
      let stillResting = false
      try {
        const opened = (await api.openedOrders(uuid)) ?? []
        const row = findOpenedRowByTicket(opened, found.ticket)
        stillResting = row != null && isPendingEntryRow(row)
      } catch {
        // Unreadable snapshot: stillResting stays false, so we do not cancel.
      }
      if (stillResting) {
        try {
          await cancelPendingOrderAtBroker(api, uuid, found.ticket)
          cancelled = true
        } catch (err) {
          console.error(
            `[tradeExecutor] strict pending reconcile rollback FAILED`
            + ` signal=${signal.id} broker=${broker.id} ticket=${found.ticket}`
            + ` (order is LIVE and untracked): ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      } else {
        console.error(
          `[tradeExecutor] strict pending reconcile rollback SKIPPED`
          + ` signal=${signal.id} broker=${broker.id} ticket=${found.ticket}`
          + ' — not confirmed resting in a fresh snapshot (filled, gone, or unreadable)',
        )
      }
    }
    console.error(
      `[tradeExecutor] strict pending reconcile could not record signal=${signal.id}`
      + ` broker=${broker.id} ticket=${found.ticket} filled=${found.filled}`
      + ` cancelled=${cancelled}: ${reason}`,
    )
    return { ok: false, ticket: found.ticket, cancelled }
  }

  try {
    const isBuyLeg = intent.pendingOp === 'BuyLimit'

    // Prefer what the broker reports; fall back to OUR clamped stops, never the
    // raw unclamped ones — the stored SL/TP must match what is on the order.
    const clampedFallback = clampOrderStops({
      symbol,
      operation: intent.pendingOp,
      volume: intent.volume,
      price: intent.entryPx,
      stoploss: intent.stoploss,
      takeprofit: intent.takeprofit,
      slippage: intent.slippage,
      comment: intent.comment,
      expertID: intent.expertID,
    }, prep.params)
    const sl = found.stopLoss ?? (Number(clampedFallback.args.stoploss) > 0 ? Number(clampedFallback.args.stoploss) : null)
    const tp = found.takeProfit ?? (Number(clampedFallback.args.takeprofit) > 0 ? Number(clampedFallback.args.takeprofit) : null)
    const slippage = clampedFallback.args.slippage ?? intent.slippage ?? 20
    const entryPx = found.openPrice ?? intent.entryPx
    const lots = found.lots ?? intent.volume

    const autoBeCols = autoManagementTradeSnapshot(prep.manual, entryPx, sl, {
      tpHitTriggerPrice: prep.plan.autoBeTpHitTriggerPrice ?? tp,
    })

    const tradeInsert = await ctx.supabase
      .from('trades')
      .insert({
        user_id: signal.user_id,
        signal_id: signal.id,
        telegram_channel_id: signal.channel_id,
        broker_account_id: broker.id,
        metaapi_order_id: tradeTicket,
        symbol,
        direction: isBuyLeg ? 'buy' : 'sell',
        entry_price: entryPx,
        sl,
        tp,
        lot_size: lots,
        status: 'pending',
        opened_at: new Date().toISOString(),
        cwe_close_price: null,
        next_tp_index: intent.nextTpIndex,
        ...autoBeCols,
      })
      .select('id')
      .maybeSingle()

    if (tradeInsert.error) {
      // TOCTOU: a concurrent writer can claim the ticket between the ownership
      // pre-check above and this insert. A duplicate key means another row owns
      // it — rolling that live order back would be exactly the wrong outcome.
      if (isDuplicateKeyError(tradeInsert.error)) {
        console.warn(
          `[tradeExecutor] strict pending ticket ${tradeTicket} claimed concurrently`
          + ` signal=${signal.id} broker=${broker.id} — not adopting, not cancelling`,
        )
        return { ok: false, ticket: found.ticket, cancelled: false, alreadyTracked: true }
      }
      return await fail(`trades insert failed: ${tradeInsert.error.message}`)
    }
    const tradeId = (tradeInsert.data as { id?: string } | null)?.id
    if (!tradeId) {
      return await fail('trades insert returned no id')
    }

    const { error: sepErr } = await ctx.supabase.from('signal_entry_pending_orders').insert({
      signal_id: signal.id,
      user_id: signal.user_id,
      broker_account_id: broker.id,
      metaapi_account_id: uuid,
      symbol,
      trade_id: tradeId,
      is_buy: isBuyLeg,
      operation: intent.pendingOp,
      entry_price: entryPx,
      volume: intent.volume,
      stoploss: sl,
      takeprofit: tp,
      slippage,
      comment: intent.comment,
      expert_id: intent.expertID,
      broker_ticket: tradeTicket,
      status: 'broker_pending',
      expires_at: intent.expiresAt,
      partial_tp_plan: intent.partialTpPlan,
    })

    if (sepErr) {
      // Remove the half-written trades row so it cannot look like a tracked
      // trade, then roll the broker order back like the normal path does.
      await ctx.supabase.from('trades').delete().eq('id', tradeId)
      return await fail(`signal_entry_pending_orders insert failed: ${sepErr.message}`)
    }

    persisted = true

    console.warn(
      `[tradeExecutor] adopted timed-out strict pending signal=${signal.id}`
      + ` broker=${broker.id} ticket=${tradeTicket} op=${intent.pendingOp}`
      + ` symbol=${symbol} filled=${found.filled}`,
    )

    try {
      await writeExecutionLog(ctx.supabase, {
        user_id: signal.user_id,
        signal_id: signal.id,
        broker_account_id: broker.id,
        action: 'signal_entry_pending_placed',
        status: 'success',
        request_payload: {
          ticket: tradeTicket,
          operation: intent.pendingOp,
          entry_price: entryPx,
          volume: intent.volume,
          takeprofit: tp,
          symbol,
          digits: intent.digits,
          adopted_after_timeout: true,
          filled_at_broker: found.filled,
        } as unknown as Record<string, unknown>,
        response_payload: { trade_id: tradeId } as unknown as Record<string, unknown>,
      })
    } catch { /* best-effort */ }

    return { ok: true }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return await fail(`unexpected: ${detail}`)
  }
}

export type TimedOutReconcileResult = {
  /** True when the order was found at the broker AND both rows were written. */
  adopted: boolean
  /**
   * Short fixed phrase for the customer-facing `error_message` column. Always
   * carries the ticket when one was found, never raw broker text. The caller
   * renders it as `broker check: <note>`, so the prefix is not repeated here.
   */
  note: string | null
}

const NO_CHECK: TimedOutReconcileResult = { adopted: false, note: null }

/**
 * Single entry point for the catch block of `placeOneStrictPending`.
 *
 * Decides whether a broker check applies (timeout only, honouring
 * `MTAPI_RECONCILE_ON_TIMEOUT=false`), runs it, and persists the order when it
 * is live. Kept out of the caller so that file gains one import and one call
 * rather than a block of logic.
 *
 * Keeps the dispatch claim renewed for the WHOLE check, not just the probe:
 * the /OpenedOrders read, the ownership count, both inserts and — on failure —
 * a second read plus `orderCancel` can together exceed the 120s lease on a
 * degraded bridge, which is exactly the condition that produces these timeouts.
 * A stale lease lets a second dispatcher re-send a signal that still has no
 * rows, i.e. a duplicate entry. The renewal is a bare UPDATE, so it is safe
 * when no claim row exists.
 *
 * Never resends and never reports a pending as absent, so a check that cannot
 * prove anything simply returns a terse reason for the failure log while the
 * full detail goes to the console.
 */
export async function reconcileTimedOutStrictPending(
  intent: StrictPendingIntent,
  humanizedError: string,
): Promise<TimedOutReconcileResult> {
  if (!isOrderOpTimedOutMessage(humanizedError)) return NO_CHECK
  if (process.env.MTAPI_RECONCILE_ON_TIMEOUT === 'false') return NO_CHECK

  const { ctx, prep } = intent
  if (!prep.api) return NO_CHECK

  const where = `signal=${prep.signal.id} broker=${prep.broker.id}`

  const renew = (): void => {
    void renewSignalBrokerDispatchClaim(ctx.supabase, prep.signal.id, prep.broker.id).catch(() => false)
  }
  renew()
  const leaseTimer = setInterval(
    renew,
    Math.max(15_000, Math.floor(SIGNAL_DISPATCH_CLAIM_LEASE_MS / 3)),
  )

  try {
    let found: StrictPendingReconcile
    try {
      found = await reconcileStrictPending(prep.api, prep.uuid, {
        symbol: prep.symbol,
        operation: intent.pendingOp,
        comment: intent.comment,
        volume: intent.volume,
        lotStep: prep.params?.lotStep,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.warn(`[tradeExecutor] strict entry broker check threw ${where}: ${detail}`)
      return { adopted: false, note: 'failed' }
    }

    if (found.status !== 'adopted') {
      console.warn(`[tradeExecutor] strict entry broker check inconclusive ${where}: ${found.reason}`)
      return {
        adopted: false,
        note: found.reason.startsWith('broker read failed') ? 'failed' : 'inconclusive',
      }
    }

    let outcome: AdoptOutcome
    try {
      outcome = await adoptTimedOutStrictPending(intent, found)
    } catch (err) {
      // adoptTimedOutStrictPending handles its own throws; this is belt and
      // braces so the caller's audit row can never be skipped.
      const detail = err instanceof Error ? err.message : String(err)
      console.error(`[tradeExecutor] strict pending reconcile escaped ${where}: ${detail}`)
      return { adopted: false, note: `order #${found.ticket} not recorded` }
    }

    if (outcome.ok) return { adopted: true, note: null }

    // The ticket was already owned by another row. Not ours to adopt, and
    // definitely not ours to cancel — the broker order is left exactly as it
    // was and our own order stays unknown.
    if (outcome.alreadyTracked) {
      return { adopted: false, note: 'inconclusive' }
    }

    // The ticket MUST reach the audit row: for a fill we cannot cancel it, so
    // this log line is the only record that a live position exists untracked.
    const disposition = outcome.cancelled ? 'cancelled, not recorded' : 'not recorded'
    return { adopted: false, note: `order #${outcome.ticket} ${disposition}` }
  } finally {
    clearInterval(leaseTimer)
  }
}
