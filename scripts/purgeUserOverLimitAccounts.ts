/**
 * One-shot: purge over-limit brokers (via FxSocket DELETE) + excess telegram channels.
 *
 * Usage (from repo root):
 *   set -a && source worker/.env && set +a && \
 *   npx --yes tsx scripts/purgeUserOverLimitAccounts.ts
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FXSOCKET_API_KEY
 * Optional:
 *   TARGET_USER_ID (default: Ramandeep over-limit user)
 *   KEEP_BROKERS=1 KEEP_CHANNELS=5
 *   DRY_RUN=1
 */
import { createClient } from '@supabase/supabase-js'

const USER_ID = process.env.TARGET_USER_ID ?? 'c8a32918-9d96-4478-9869-a9e9cb1eccb1'
const KEEP_BROKERS = Math.max(0, Number(process.env.KEEP_BROKERS ?? 1))
const KEEP_CHANNELS = Math.max(0, Number(process.env.KEEP_CHANNELS ?? 5))
const DRY_RUN = process.env.DRY_RUN === '1'
const FX_BASE = (process.env.FXSOCKET_BASE_URL ?? 'https://api.fxsocket.com').replace(/\/+$/, '')

const supabaseUrl = process.env.SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const fxKey = process.env.FXSOCKET_API_KEY ?? ''

if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
if (!fxKey && !DRY_RUN) throw new Error('FXSOCKET_API_KEY required (or DRY_RUN=1)')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fxDeleteAccount(fxsocketAccountId: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${FX_BASE}/v1/accounts/${encodeURIComponent(fxsocketAccountId)}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': fxKey },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.text().catch(() => '')
  // 404 = already gone — treat as success
  return { ok: res.ok || res.status === 404, status: res.status, body: body.slice(0, 300) }
}

async function main() {
  console.log(`User ${USER_ID} keepBrokers=${KEEP_BROKERS} keepChannels=${KEEP_CHANNELS} dryRun=${DRY_RUN}`)

  const { data: brokers, error: brokerErr } = await supabase
    .from('broker_accounts')
    .select('id, label, is_active, fxsocket_account_id, created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: true })
  if (brokerErr) throw new Error(brokerErr.message)

  const { data: channels, error: channelErr } = await supabase
    .from('telegram_channels')
    .select('id, display_name, is_active, created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: true })
  if (channelErr) throw new Error(channelErr.message)

  const keepBrokerIds = new Set((brokers ?? []).slice(0, KEEP_BROKERS).map(b => b.id))
  const removeBrokers = (brokers ?? []).filter(b => !keepBrokerIds.has(b.id))
  const keepChannelIds = new Set((channels ?? []).slice(0, KEEP_CHANNELS).map(c => c.id))
  const removeChannels = (channels ?? []).filter(c => !keepChannelIds.has(c.id))

  console.log(`Brokers: keep ${keepBrokerIds.size}, remove ${removeBrokers.length}`)
  console.log(`Channels: keep ${keepChannelIds.size}, remove ${removeChannels.length}`)
  for (const b of removeBrokers) {
    console.log(`  broker remove: ${b.id} | ${b.label} | fx=${b.fxsocket_account_id || '(none)'} | active=${b.is_active}`)
  }
  for (const c of removeChannels) {
    console.log(`  channel remove: ${c.id} | ${c.display_name} | active=${c.is_active}`)
  }

  if (DRY_RUN) {
    console.log('DRY_RUN=1 — no FxSocket or DB changes')
    return
  }

  for (const b of removeBrokers) {
    const fxId = String(b.fxsocket_account_id ?? '').trim()
    if (fxId) {
      const del = await fxDeleteAccount(fxId)
      console.log(`FxSocket DELETE ${fxId}: ${del.status} ok=${del.ok}${del.body ? ` ${del.body}` : ''}`)
      if (!del.ok) {
        console.warn(`  continuing to DB delete despite FxSocket failure for ${b.id}`)
      }
    } else {
      console.log(`No fxsocket_account_id for ${b.id} — DB delete only`)
    }

    const { error } = await supabase.from('broker_accounts').delete().eq('id', b.id).eq('user_id', USER_ID)
    if (error) throw new Error(`broker delete ${b.id}: ${error.message}`)
    console.log(`DB deleted broker ${b.id}`)
  }

  if (removeChannels.length > 0) {
    const ids = removeChannels.map(c => c.id)
    const { error } = await supabase.from('telegram_channels').delete().eq('user_id', USER_ID).in('id', ids)
    if (error) throw new Error(`channel delete: ${error.message}`)
    console.log(`DB deleted ${ids.length} channels`)

    // Strip deleted channel ids from remaining brokers' whitelist arrays
    const { data: remainingBrokers } = await supabase
      .from('broker_accounts')
      .select('id, signal_channel_ids')
      .eq('user_id', USER_ID)
    const removeSet = new Set(ids)
    for (const row of remainingBrokers ?? []) {
      const prev = Array.isArray(row.signal_channel_ids) ? row.signal_channel_ids as string[] : []
      const next = prev.filter(id => !removeSet.has(id))
      if (next.length === prev.length) continue
      const { error: upErr } = await supabase
        .from('broker_accounts')
        .update({ signal_channel_ids: next })
        .eq('id', row.id)
      if (upErr) console.warn(`signal_channel_ids cleanup ${row.id}: ${upErr.message}`)
    }
  }

  const { count: brokerCount } = await supabase
    .from('broker_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', USER_ID)
  const { count: channelCount } = await supabase
    .from('telegram_channels')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', USER_ID)
  console.log(`Done. Remaining brokers=${brokerCount ?? '?'} channels=${channelCount ?? '?'}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
