/**
 * One-shot: apply parsed SL/TP to open GBPUSD basket legs that are still naked.
 *
 * Usage (from worker/):
 *   node -r dotenv/config scripts/forceReconcileGbpusdBasket.mjs
 *   DRY_RUN=1 node -r dotenv/config scripts/forceReconcileGbpusdBasket.mjs
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { getFxsocketClient, hasFxsocketConfigured } = require('../dist/fxsocketClient.js')

const SIGNAL_ID = process.env.SIGNAL_ID || '8b94c73e-dfa7-4c99-9327-6e6f86b7e108'
const BROKER_IDS = (process.env.BROKER_ACCOUNT_IDS || '8556fff2-5e52-41d4-acc8-3d8d46bc3dcb')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === '1'
  || String(process.env.DRY_RUN || '').toLowerCase() === 'true'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function num(v) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  }
  if (!DRY_RUN && !hasFxsocketConfigured()) {
    throw new Error('FXSOCKET_API_KEY required')
  }

  const { data: signal, error: sigErr } = await supabase
    .from('signals')
    .select('id,parsed_data,user_id')
    .eq('id', SIGNAL_ID)
    .maybeSingle()
  if (sigErr || !signal) throw sigErr || new Error('signal not found')

  const parsed = signal.parsed_data || {}
  const sl = num(parsed.sl)
  const tps = (parsed.tp || []).map(num).filter(t => t != null)
  if (sl == null || !tps.length) throw new Error('signal missing SL/TP ladder')

  const { data: trades, error: trErr } = await supabase
    .from('trades')
    .select('id,broker_account_id,metaapi_order_id,symbol,direction,sl,tp,lot_size,opened_at')
    .eq('signal_id', SIGNAL_ID)
    .eq('status', 'open')
    .in('broker_account_id', BROKER_IDS)
    .order('opened_at', { ascending: true })
  if (trErr) throw trErr

  const legs = trades || []
  if (!legs.length) {
    console.log('No open legs matched')
    return
  }

  // Distribute TPs across legs (farthest reserved for last bucket similar to multi %).
  const tpLots = [
    { percent: 50, enabled: true },
    { percent: 30, enabled: true },
    { percent: 20, enabled: true },
  ]
  const enabled = tpLots.filter(t => t.enabled)
  const counts = enabled.map((t, i) => {
    if (i === enabled.length - 1) return 0
    return Math.max(1, Math.round((legs.length * t.percent) / 100))
  })
  counts[counts.length - 1] = Math.max(0, legs.length - counts.slice(0, -1).reduce((a, b) => a + b, 0))
  const assignedTps = []
  for (let i = 0; i < enabled.length; i++) {
    const tp = tps[Math.min(i, tps.length - 1)]
    for (let n = 0; n < counts[i]; n++) assignedTps.push(tp)
  }
  while (assignedTps.length < legs.length) assignedTps.push(tps[tps.length - 1])

  console.log(`Signal ${SIGNAL_ID} SL=${sl} TPs=${tps.join(',')}`)
  console.log(`Brokers=${BROKER_IDS.join(',')} legs=${legs.length} dryRun=${DRY_RUN}`)

  const { data: brokers } = await supabase
    .from('broker_accounts')
    .select('id,label,platform,fxsocket_account_id')
    .in('id', BROKER_IDS)
  const brokerById = new Map((brokers || []).map(b => [b.id, b]))

  const api = DRY_RUN ? null : getFxsocketClient()
  if (!DRY_RUN && !api) throw new Error('FxSocket client unavailable')

  let modified = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const ticket = Number(leg.metaapi_order_id)
    const targetTp = assignedTps[i]
    const curSl = num(leg.sl) || 0
    const curTp = num(leg.tp) || 0
    const broker = brokerById.get(leg.broker_account_id)
    const uuid = broker?.fxsocket_account_id
    if (!Number.isFinite(ticket) || ticket <= 0 || !uuid) {
      console.log(`skip ${leg.id}: missing ticket/uuid`)
      skipped++
      continue
    }
    if (Math.abs(curSl - sl) < 1e-9 && Math.abs(curTp - targetTp) < 1e-9) {
      console.log(`ok already ${broker.label} ticket=${ticket} SL=${curSl} TP=${curTp}`)
      skipped++
      continue
    }

    console.log(
      `${DRY_RUN ? 'PLAN' : 'MODIFY'} ${broker.label} ticket=${ticket}`
      + ` SL ${curSl || 0}→${sl} TP ${curTp || 0}→${targetTp}`,
    )
    if (DRY_RUN) {
      modified++
      continue
    }

    try {
      await api.orderModify(uuid, { ticket, stoploss: sl, takeprofit: targetTp })
      await supabase
        .from('trades')
        .update({ sl, tp: targetTp })
        .eq('id', leg.id)
      await supabase.from('trade_execution_logs').insert({
        user_id: signal.user_id,
        signal_id: SIGNAL_ID,
        broker_account_id: leg.broker_account_id,
        action: 'force_reconcile_stops',
        status: 'success',
        request_payload: {
          ticket,
          target_sl: sl,
          target_tp: targetTp,
          trade_id: leg.id,
        },
      })
      modified++
      await sleep(250)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`FAIL ticket=${ticket}: ${msg}`)
      await supabase.from('trade_execution_logs').insert({
        user_id: signal.user_id,
        signal_id: SIGNAL_ID,
        broker_account_id: leg.broker_account_id,
        action: 'force_reconcile_stops',
        status: 'failed',
        error_message: msg,
        request_payload: {
          ticket,
          target_sl: sl,
          target_tp: targetTp,
          trade_id: leg.id,
        },
      })
    }
  }

  // Re-open basket reconcile job so monitor can keep converging after deploy.
  if (!DRY_RUN) {
    await supabase
      .from('basket_reconcile_jobs')
      .update({
        status: 'pending',
        attempts: 0,
        next_run_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: 'reopened after force reconcile (fx minDistance fix pending deploy)',
        updated_at: new Date().toISOString(),
      })
      .eq('anchor_signal_id', SIGNAL_ID)
      .in('broker_account_id', BROKER_IDS)
  }

  console.log(`\nDone modified=${modified} failed=${failed} skipped=${skipped}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
