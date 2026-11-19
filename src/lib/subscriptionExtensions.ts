/**
 * Admin-granted access extensions (rows of the subscription_extensions table).
 *
 * A grant keeps a user's access alive after the trial or paid period ends.
 * Every access check treats "a live grant" as a third way to be active,
 * alongside an active subscription and an unexpired trial.
 *
 * WINDOW RULE
 * -----------
 * A grant given to a customer who is still paying must not run during their paid
 * access; it starts when that access ends. The anchor is the subscription's period
 * end (`current_period_end`), or the trial end (`trial_ends_at`):
 *
 *   - subscription still running and its end is in the future -> queue the grant
 *     at that end (nothing is consumed while they pay);
 *   - otherwise -> the paid access is over (or the status already says so), so the
 *     grant starts at that end, clamped to now, or at the grant date if that is
 *     later.
 *
 * The end date is read from the row even when the status is no longer `active`:
 * the Stripe webhook flips the status to `canceled` and deliberately keeps
 * `current_period_end`, and discarding it there is what made a grant expire unused
 * on the ordinary cancellation path.
 */

export interface SubscriptionExtensionGrant {
  days: number
  granted_at: string
}

export interface SubscriptionTiming {
  status?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
}

/** End of the paid period, else the trial, regardless of the current status. */
export function subscriptionEndMs(sub: SubscriptionTiming | null | undefined): number | null {
  if (!sub) return null
  const raw = sub.current_period_end ?? sub.trial_ends_at ?? null
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** True when the subscription is still running, so a grant must wait for its end. */
export function queuesUntilSubscriptionEnd(
  sub: SubscriptionTiming | null | undefined,
  endMs: number | null,
  now = Date.now(),
): boolean {
  if (endMs == null || endMs <= now) return false
  return sub?.status === 'active' || sub?.status === 'trialing'
}

/** Start of one grant window. */
export function grantStartMs(
  grant: SubscriptionExtensionGrant,
  sub: SubscriptionTiming | null | undefined,
  now = Date.now(),
): number | null {
  const granted = Date.parse(grant.granted_at)
  if (Number.isNaN(granted)) return null
  const end = subscriptionEndMs(sub)
  if (end == null) return granted
  if (queuesUntilSubscriptionEnd(sub, end, now)) {
    return Math.max(granted, end)
  }
  return Math.max(granted, Math.min(end, now))
}

/** End of one grant, or null when the row is unusable. */
export function grantEndMs(
  grant: SubscriptionExtensionGrant,
  sub: SubscriptionTiming | null | undefined,
  now = Date.now(),
): number | null {
  const days = Number(grant.days)
  const start = grantStartMs(grant, sub, now)
  if (!Number.isFinite(days) || days <= 0 || start == null) return null
  return start + days * 86_400_000
}

/**
 * Latest end across grants that have already started.
 *
 * A grant queued behind a running period is NOT active: counting its end as live
 * would show a paying Basic customer as Advanced before their period ends.
 */
export function latestExtensionEndMs(
  grants: SubscriptionExtensionGrant[] | null | undefined,
  sub: SubscriptionTiming | null | undefined,
  now = Date.now(),
): number | null {
  let latest: number | null = null
  for (const grant of grants ?? []) {
    const start = grantStartMs(grant, sub, now)
    const end = grantEndMs(grant, sub, now)
    if (start == null || end == null || start > now) continue
    if (latest == null || end > latest) latest = end
  }
  return latest
}

/** Start of the earliest grant queued behind a running period, for display. */
export function pendingExtensionStartMs(
  grants: SubscriptionExtensionGrant[] | null | undefined,
  sub: SubscriptionTiming | null | undefined,
  now = Date.now(),
): number | null {
  let next: number | null = null
  for (const grant of grants ?? []) {
    const start = grantStartMs(grant, sub, now)
    if (start == null || start <= now) continue
    if (next == null || start < next) next = start
  }
  return next
}

/** True while a grant window is still open. */
export function isExtensionActive(endMs: number | null | undefined, now = Date.now()): boolean {
  return endMs != null && endMs > now
}
