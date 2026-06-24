/**
 * FxSocket live contract smoke test (Phase 0/1 validation).
 *
 * Safe by default: only READ endpoints (OpenedOrders, getQuote) run unless you
 * explicitly opt into a guarded micro order round-trip on a DEMO account.
 *
 * Usage (from worker/):
 *   FXSOCKET_API_KEY=fxs_live_... \
 *   FX_SMOKE_ACCOUNT=<fxsocket_account_id> \
 *   FX_SMOKE_SYMBOL=XAUUSD \
 *   node --require ts-node/register scripts/fxSmoke.ts
 *
 * To also exercise OrderSend -> OrderModify -> OrderClose with the smallest
 * possible volume (ONLY do this on a demo account):
 *   FX_SMOKE_LIVE_ORDER=1 FX_SMOKE_VOLUME=0.01 ...same as above...
 *
 * It prints raw responses + the strict classification + timings so we can
 * confirm the documented contract (retcode 10009, SL/TP-at-send, etc.) matches
 * the live API before building the rest of the engine on top of it.
 */
import { FxClient, type MtPlatform } from '../src/engine/fxClient'
import { classifyOrderResponse } from '../src/engine/fxContract'

const API_KEY = process.env.FXSOCKET_API_KEY ?? ''
const ACCOUNT = process.env.FX_SMOKE_ACCOUNT ?? ''
const PLATFORM = (process.env.FX_SMOKE_PLATFORM ?? 'MT5') as MtPlatform
const SYMBOL = process.env.FX_SMOKE_SYMBOL ?? 'XAUUSD'
const LIVE_ORDER = process.env.FX_SMOKE_LIVE_ORDER === '1'
const VOLUME = Math.max(0.01, Number(process.env.FX_SMOKE_VOLUME ?? 0.01))

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now()
  try {
    const r = await fn()
    console.log(`\n[${label}] ok in ${Date.now() - t0}ms`)
    console.log(JSON.stringify(r, null, 2))
    return r
  } catch (err) {
    console.log(`\n[${label}] FAILED in ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function main() {
  if (!API_KEY) throw new Error('FXSOCKET_API_KEY is required')
  if (!ACCOUNT) throw new Error('FX_SMOKE_ACCOUNT (fxsocket_account_id) is required')
  console.log(`FxSocket smoke: account=${ACCOUNT} platform=${PLATFORM} symbol=${SYMBOL} liveOrder=${LIVE_ORDER}`)

  const fx = new FxClient({ apiKey: API_KEY })

  const quote = await timed('getQuote', () => fx.quote(ACCOUNT, PLATFORM, SYMBOL))
  await timed('openedOrders', () => fx.openedOrders(ACCOUNT, PLATFORM))

  if (!LIVE_ORDER) {
    console.log('\nRead-only smoke complete. Set FX_SMOKE_LIVE_ORDER=1 (DEMO ONLY) to test order round-trip.')
    return
  }
  if (!quote) throw new Error('cannot run live order without a quote')

  const isBuy = true
  const pre = await fx.openedOrders(ACCOUNT, PLATFORM)
  // Place a protected market order (SL/TP attached at send) far from price so it lingers.
  const sl = +(quote.bid * 0.97).toFixed(2)
  const tp = +(quote.ask * 1.03).toFixed(2)
  const send = await timed('OrderSend (protected market)', () =>
    fx.orderSend(ACCOUNT, PLATFORM, { symbol: SYMBOL, operation: 'Buy', volume: VOLUME, stopLoss: sl, takeProfit: tp }, { anchorSignalId: 'smoke-test-0000', legIndex: 0, preSnapshot: pre }))
  if (send?.ok && send.ticket) {
    console.log('classified:', classifyOrderResponse(send.raw))
    await timed('OrderModify (tighten SL)', () =>
      fx.orderModify(ACCOUNT, PLATFORM, { ticket: send.ticket!, stopLoss: +(quote.bid * 0.98).toFixed(2) }))
    await timed('OrderClose (full)', () =>
      fx.orderClose(ACCOUNT, PLATFORM, { ticket: send.ticket! }))
  } else {
    console.log('OrderSend did not return an ok ticket; skipping modify/close.')
  }
  console.log('\nLive order round-trip complete.')
}

main().catch(err => { console.error(err); process.exit(1) })
