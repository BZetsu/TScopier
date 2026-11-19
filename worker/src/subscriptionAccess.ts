import type { SupabaseClient } from '@supabase/supabase-js'
import {
  effectivePlan,
  isSubscriptionActive,
  manualSettingsUseAdvancedFeatures,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from './planLimits'
import { isAdminAccessActive } from './adminAccess'

export interface UserSubscriptionRow {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  extra_accounts: number
  trial_ends_at: string | null
  /** End of the paid period; a grant given while paying starts after this. */
  current_period_end?: string | null
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { expiresAt: number; row: UserSubscriptionRow | null }>()
const adminCache = new Map<string, { expiresAt: number; isAdmin: boolean }>()
const extensionCache = new Map<string, { expiresAt: number; endMs: number | null; subEndMs: number | null; queued: boolean }>()

/**
 * End of the paid period, else the trial — read regardless of the current status.
 * The Stripe webhook flips the status to `canceled` and keeps `current_period_end`,
 * so discarding it there is what made a grant expire unused on cancellation.
 */
export function subscriptionEndMs(sub: UserSubscriptionRow | null | undefined): number | null {
  if (!sub) return null
  const raw = sub.current_period_end ?? sub.trial_ends_at ?? null
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** True when the subscription is still running, so a grant must wait for its end. */
export function queuesUntilSubscriptionEnd(
  sub: UserSubscriptionRow | null | undefined,
  endMs: number | null,
  now = Date.now(),
): boolean {
  if (endMs == null || endMs <= now) return false
  return sub?.status === 'active' || sub?.status === 'trialing'
}

/**
 * Latest admin-granted extension end in epoch milliseconds, cached for a minute.
 *
 * The window starts at the later of the grant date and the end of the paid period:
 * a grant given to a paying customer must not run while they are still paying.
 */
export async function loadCachedSubscriptionExtensionEnd(
  supabase: SupabaseClient,
  userId: string,
  sub: UserSubscriptionRow | null = null,
): Promise<number | null> {
  const subEndMs = subscriptionEndMs(sub)
  const queued = queuesUntilSubscriptionEnd(sub, subEndMs)
  const hit = extensionCache.get(userId)
  if (hit && hit.expiresAt > Date.now() && hit.subEndMs === subEndMs && hit.queued === queued) return hit.endMs

  const { data, error } = await supabase
    .from('subscription_extensions')
    .select('days, granted_at')
    .eq('user_id', userId)
    .order('granted_at', { ascending: false })
    .limit(30)

  let endMs: number | null = null
  if (!error && data) {
    for (const row of data) {
      const days = Number((row as { days: unknown }).days)
      const start = Date.parse(String((row as { granted_at: unknown }).granted_at ?? ''))
      if (Number.isFinite(days) && days > 0 && !Number.isNaN(start)) {
        const now = Date.now()
        const windowStart = subEndMs == null
          ? start
          : queued
            ? Math.max(start, subEndMs)
            : Math.max(start, Math.min(subEndMs, now))
        // A window queued behind a paid period has not started: it does not grant access yet.
        if (windowStart > now) continue
        const end = windowStart + days * 86_400_000
        if (endMs == null || end > endMs) endMs = end
      }
    }
  }
  extensionCache.set(userId, { endMs, expiresAt: Date.now() + CACHE_TTL_MS, subEndMs, queued })
  return endMs
}

/** True while an admin-granted extension window is still open. */
export function extensionAccessActive(endMs: number | null, now = Date.now()): boolean {
  return endMs != null && endMs > now
}

export async function loadCachedUserSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSubscriptionRow | null> {
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return hit.row

  const { data } = await supabase
    .from('subscriptions')
    .select('plan,status,extra_accounts,trial_ends_at,current_period_end')
    .eq('user_id', userId)
    .maybeSingle()

  const row = (data as UserSubscriptionRow | null) ?? null
  cache.set(userId, { row, expiresAt: Date.now() + CACHE_TTL_MS })
  return row
}

function adminUserIdsFromEnv(): Set<string> {
  const raw = process.env.TSCOPIER_ADMIN_USER_IDS ?? ''
  return new Set(raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean))
}

export async function loadCachedUserIsAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const hit = adminCache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return hit.isAdmin

  let isAdmin = adminUserIdsFromEnv().has(userId)

  if (!isAdmin) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('is_admin, admin_until')
      .eq('user_id', userId)
      .maybeSingle()
    if (!error && isAdminAccessActive(data)) isAdmin = true
  }

  if (!isAdmin) {
    try {
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(userId)
      if (!authErr && authData?.user) {
        const meta = authData.user.app_metadata ?? {}
        if (meta.is_admin === true || meta.role === 'admin') isAdmin = true
      }
    } catch {
      /* best-effort */
    }
  }

  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS })
  return isAdmin
}

export function brokerManualSettingsUseAdvancedFeatures(
  manualSettings: Record<string, unknown> | null | undefined,
): boolean {
  if (!manualSettings || typeof manualSettings !== 'object') return false
  return manualSettingsUseAdvancedFeatures(manualSettings)
}

export function subscriptionBlocksSignalExecution(
  sub: UserSubscriptionRow | null,
  manualSettings: Record<string, unknown> | null | undefined,
  isAdmin = false,
  extensionEndMs: number | null = null,
): string | null {
  if (isAdmin) return null
  const active = isSubscriptionActive(sub?.status, sub?.trial_ends_at)
  if (!active && !extensionAccessActive(extensionEndMs)) return 'subscription_inactive'
  // A live admin extension is granted as Advanced while it is the reason access is alive.
  const plan = active
    ? effectivePlan(sub?.plan, sub?.status, sub?.trial_ends_at)
    : 'advanced'
  if (plan === 'basic' && brokerManualSettingsUseAdvancedFeatures(manualSettings)) {
    return 'plan_advanced_feature_required'
  }
  return null
}

/** True when the worker may start or renew a Telegram listener for this user. */
export async function userMayRunCopierListener(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (await loadCachedUserIsAdmin(supabase, userId)) return true
  const sub = await loadCachedUserSubscription(supabase, userId)
  if (isSubscriptionActive(sub?.status, sub?.trial_ends_at)) return true
  return extensionAccessActive(await loadCachedSubscriptionExtensionEnd(supabase, userId, sub))
}

export { isSubscriptionActive, effectivePlan, manualSettingsUseAdvancedFeatures }
