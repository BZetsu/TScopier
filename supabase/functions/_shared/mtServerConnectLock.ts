import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import { mtServerLockKey, withMtServerSessionLock } from "./mtServerSessionLock.ts"

const LOCK_WAIT_MS = 90_000
const LOCK_POLL_MS = 500
const LOCK_TTL_SEC = 120

function holderId(): string {
  return `edge:${crypto.randomUUID()}`
}

async function tryAcquireDistributedLock(
  supabase: SupabaseClient,
  lockKey: string,
  holder: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_mt_server_connect_lock", {
    p_lock_key: lockKey,
    p_holder: holder,
    p_ttl_seconds: LOCK_TTL_SEC,
  })
  if (error) {
    console.warn(`[mtServerConnectLock] acquire failed key=${lockKey}: ${error.message}`)
    return true
  }
  return Boolean(data)
}

async function releaseDistributedLock(
  supabase: SupabaseClient,
  lockKey: string,
  holder: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_mt_server_connect_lock", {
    p_lock_key: lockKey,
    p_holder: holder,
  })
  if (error) {
    console.warn(`[mtServerConnectLock] release failed key=${lockKey}: ${error.message}`)
  }
}

async function waitForDistributedLock(
  supabase: SupabaseClient,
  lockKey: string,
  holder: string,
): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MS
  while (Date.now() < deadline) {
    if (await tryAcquireDistributedLock(supabase, lockKey, holder)) return true
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS))
  }
  console.warn(`[mtServerConnectLock] timed out waiting key=${lockKey}`)
  return false
}

export async function withDistributedMtServerConnectLock<T>(
  supabase: SupabaseClient,
  platform: string,
  server: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = mtServerLockKey(platform, server)
  const holder = holderId()
  return withMtServerSessionLock(platform, server, async () => {
    const acquired = await waitForDistributedLock(supabase, lockKey, holder)
    if (!acquired) {
      throw new Error(`Timed out waiting for MT server connect lock (${lockKey})`)
    }
    try {
      return await fn()
    } finally {
      await releaseDistributedLock(supabase, lockKey, holder)
    }
  })
}
