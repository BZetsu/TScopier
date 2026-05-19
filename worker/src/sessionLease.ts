import type { SupabaseClient } from '@supabase/supabase-js'
import { listenerWorkerId, leaseRoleLabel, workerConfig } from './workerConfig'

const LEASE_TTL_MS = Math.max(
  15_000,
  Math.min(120_000, Number(process.env.WORKER_SESSION_LEASE_TTL_MS ?? 45_000)),
)

export interface SessionLeaseRow {
  user_id: string
  worker_id: string
  role: string
  shard_id: number
  shard_count: number
  expires_at: string
}

function expiresAtIso(): string {
  return new Date(Date.now() + LEASE_TTL_MS).toISOString()
}

/**
 * Claim listener ownership for user_id. Fails if another worker holds a non-expired lease.
 */
export async function acquireSessionLease(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const workerId = listenerWorkerId()
  const now = new Date().toISOString()

  const { data: existing } = await supabase
    .from('worker_session_leases')
    .select('worker_id, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    const exp = new Date(existing.expires_at as string).getTime()
    const held = existing.worker_id as string
    if (exp > Date.now() && held !== workerId) {
      return { ok: false, reason: `lease held by ${held} until ${existing.expires_at}` }
    }
  }

  const { error } = await supabase.from('worker_session_leases').upsert(
    {
      user_id: userId,
      worker_id: workerId,
      role: leaseRoleLabel(),
      shard_id: workerConfig.shardId,
      shard_count: workerConfig.shardCount,
      expires_at: expiresAtIso(),
      updated_at: now,
    },
    { onConflict: 'user_id' },
  )

  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

export async function renewSessionLease(supabase: SupabaseClient, userId: string): Promise<void> {
  const workerId = listenerWorkerId()
  await supabase
    .from('worker_session_leases')
    .update({
      worker_id: workerId,
      expires_at: expiresAtIso(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('worker_id', workerId)
}

export async function releaseSessionLease(supabase: SupabaseClient, userId: string): Promise<void> {
  const workerId = listenerWorkerId()
  await supabase
    .from('worker_session_leases')
    .delete()
    .eq('user_id', userId)
    .eq('worker_id', workerId)
}

/** Trade workers: true when a listener shard holds a fresh lease (Telegram path is live). */
export async function isTelegramListenerLiveForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('worker_session_leases')
    .select('expires_at, role')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return false
  const role = String(data.role ?? '')
  if (role !== 'listener' && role !== 'all') return false
  return new Date(data.expires_at as string).getTime() > Date.now()
}

export async function listActiveLeases(
  supabase: SupabaseClient,
): Promise<SessionLeaseRow[]> {
  const { data } = await supabase
    .from('worker_session_leases')
    .select('*')
    .gt('expires_at', new Date().toISOString())
  return (data ?? []) as SessionLeaseRow[]
}
