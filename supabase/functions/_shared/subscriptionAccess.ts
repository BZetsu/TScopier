import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  effectivePlan,
  isSubscriptionActive,
  BACKTEST_QUOTA_RUN_MODE,
  maxBacktestsPerMonth,
  maxBrokerAccounts,
  maxTelegramChannels,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "./planLimits.ts";
import { isAdminAccessActive } from "./adminAccess.ts";

export interface UserSubscriptionRow {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  extra_accounts: number;
  trial_ends_at: string | null;
  /** End of the paid period; a grant given while paying starts after this. */
  current_period_end?: string | null;
}

export type SubscriptionLoadResult = {
  data: UserSubscriptionRow | null;
  error: { message: string } | null;
};

/** Load a subscription while preserving database errors for authoritative read paths. */
export async function loadUserSubscriptionResult(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionLoadResult> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan,status,extra_accounts,trial_ends_at,current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { data: null, error: { message: error.message } };
  return { data: data ? (data as UserSubscriptionRow) : null, error: null };
}

export async function loadUserSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSubscriptionRow | null> {
  const result = await loadUserSubscriptionResult(supabase, userId);
  return result.data;
}

function adminUserIdsFromEnv(): Set<string> {
  const raw = Deno.env.get("TSCOPIER_ADMIN_USER_IDS") ?? "";
  return new Set(
    raw.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.length > 0),
  );
}

type SubscriptionTiming = {
  status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
};

/**
 * End of the paid period, else the trial — read regardless of the current status.
 * The Stripe webhook flips the status to `canceled` and keeps `current_period_end`,
 * so discarding it there is what made a grant expire unused on cancellation.
 */
export function subscriptionEndMs(
  sub: SubscriptionTiming | null | undefined,
): number | null {
  if (!sub) return null;
  const raw = sub.current_period_end ?? sub.trial_ends_at ?? null;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** True when the subscription is still running, so a grant must wait for its end. */
export function queuesUntilSubscriptionEnd(
  sub: SubscriptionTiming | null | undefined,
  endMs: number | null,
  now = Date.now(),
): boolean {
  if (endMs == null || endMs <= now) return false;
  return sub?.status === "active" || sub?.status === "trialing";
}

/**
 * True when a single grant window is open at `now`.
 *
 * A grant given to a paying customer starts at the period end (queued), not while
 * they are still paying; one given after that period started at that end.
 */
export function extensionWindowActive(
  days: unknown,
  grantedAt: unknown,
  now = Date.now(),
  sub: SubscriptionTiming | null = null,
): boolean {
  const d = Number(days);
  const granted = Date.parse(String(grantedAt ?? ""));
  if (!Number.isFinite(d) || d <= 0 || Number.isNaN(granted)) return false;
  const end = subscriptionEndMs(sub);
  const start = end == null
    ? granted
    : queuesUntilSubscriptionEnd(sub, end, now)
      ? Math.max(granted, end)
      : Math.max(granted, Math.min(end, now));
  return start <= now && start + d * 86_400_000 > now;
}

export type SubscriptionExtensionLookupResult = {
  hasLiveExtension: boolean;
  error: { message: string } | null;
};

/** Load extension state while preserving database errors for authoritative read paths. */
export async function loadLiveSubscriptionExtension(
  supabase: SupabaseClient,
  userId: string,
  sub: SubscriptionTiming | null = null,
): Promise<SubscriptionExtensionLookupResult> {
  const { data, error } = await supabase
    .from("subscription_extensions")
    .select("days, granted_at")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false })
    .limit(30);
  if (error) {
    return { hasLiveExtension: false, error: { message: error.message } };
  }
  return {
    hasLiveExtension: (data ?? []).some((row) =>
      extensionWindowActive(row.days, row.granted_at, Date.now(), sub),
    ),
    error: null,
  };
}

/** True when any admin-granted access extension is still live for this user. */
export async function hasLiveSubscriptionExtension(
  supabase: SupabaseClient,
  userId: string,
  sub: SubscriptionTiming | null = null,
): Promise<boolean> {
  const result = await loadLiveSubscriptionExtension(supabase, userId, sub);
  if (result.error) {
    console.warn(
      `[subscriptionAccess] extension lookup failed for ${userId}: ${result.error.message}`,
    );
    return false;
  }
  return result.hasLiveExtension;
}

export type AdminAccessLoadResult = {
  isAdmin: boolean;
  error: { message: string } | null;
};

/** Resolve admin access while preserving lookup errors for authoritative read paths. */
export async function loadUserIsAdminResult(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminAccessLoadResult> {
  if (adminUserIdsFromEnv().has(userId)) {
    return { isAdmin: true, error: null };
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("is_admin, admin_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (!error && isAdminAccessActive(data)) {
    return { isAdmin: true, error: null };
  }

  try {
    const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(
      userId,
    );
    if (authErr) {
      return { isAdmin: false, error: { message: authErr.message } };
    }
    const meta = authData?.user?.app_metadata ?? {};
    if (meta.is_admin === true || meta.role === "admin") {
      return { isAdmin: true, error: null };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isAdmin: false, error: { message: msg } };
  }

  if (error) return { isAdmin: false, error: { message: error.message } };
  return { isAdmin: false, error: null };
}

/** True when user bypasses subscription limits (DB flag, env list, or Auth app_metadata). */
export async function loadUserIsAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const result = await loadUserIsAdminResult(supabase, userId);
  if (result.error) {
    console.warn(
      `[subscriptionAccess] admin access lookup failed for ${userId}: ${result.error.message}`,
    );
  }
  return result.isAdmin;
}

export function subscriptionAccessDenied(
  message: string,
  code: string,
  status = 403,
): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type PlanLimitCountOptions = {
  /** How many additional active slots this action needs (default 1). */
  slotsNeeded?: number;
  /** Existing row ids that will be reactivated / updated and must not count twice. */
  excludeRowIds?: string[];
};

export async function assertBrokerAccountLimit(
  supabase: SupabaseClient,
  userId: string,
  sub: UserSubscriptionRow | null,
  options: PlanLimitCountOptions = {},
): Promise<Response | null> {
  if (await loadUserIsAdmin(supabase, userId)) return null;

  let plan = effectivePlan(sub?.plan, sub?.status, sub?.trial_ends_at);
  if (!plan && (await hasLiveSubscriptionExtension(supabase, userId, sub))) {
    // A live admin extension grants Advanced while it is the reason access is alive.
    plan = "advanced";
  }
  if (!plan) {
    return subscriptionAccessDenied(
      "An active subscription is required to connect broker accounts.",
      "subscription_required",
    );
  }
  const limit = maxBrokerAccounts(plan, sub?.extra_accounts ?? 0);
  const slotsNeeded = options.slotsNeeded ?? 1;
  if (slotsNeeded <= 0) return null;
  const { data, error } = await supabase
    .from("broker_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error || !data) {
    console.warn(
      `[subscriptionAccess] broker limit count failed for ${userId}: ${error?.message ?? "null data"}`,
    );
    return subscriptionAccessDenied(
      "Unable to verify broker account limits. Try again.",
      "limit_check_failed",
      503,
    );
  }
  const exclude = new Set((options.excludeRowIds ?? []).filter(Boolean));
  const count = data.reduce((n, row) => n + (exclude.has(row.id) ? 0 : 1), 0);
  if (count + slotsNeeded > limit) {
    return subscriptionAccessDenied(
      plan === "basic"
        ? "Basic plan allows 1 broker account. Upgrade to Advanced for more."
        : `Your plan allows ${limit} broker accounts. Add more from Billing.`,
      "broker_account_limit",
    );
  }
  return null;
}

export async function assertBacktestMonthlyLimit(
  supabase: SupabaseClient,
  userId: string,
  sub: UserSubscriptionRow | null,
): Promise<Response | null> {
  if (await loadUserIsAdmin(supabase, userId)) return null;

  let plan = effectivePlan(sub?.plan, sub?.status, sub?.trial_ends_at);
  if (!plan && (await hasLiveSubscriptionExtension(supabase, userId, sub))) {
    // A live admin extension grants Advanced while it is the reason access is alive.
    plan = "advanced";
  }
  if (!plan) {
    return subscriptionAccessDenied(
      "An active subscription is required to run backtests.",
      "subscription_required",
    );
  }
  const limit = maxBacktestsPerMonth(plan);
  if (limit == null) return null;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("backtest_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("config->>runMode", BACKTEST_QUOTA_RUN_MODE)
    .gte("created_at", monthStart.toISOString());
  if (error || count == null) {
    console.warn(
      `[subscriptionAccess] backtest limit count failed for ${userId}: ${error?.message ?? "null count"}`,
    );
    return subscriptionAccessDenied(
      "Unable to verify backtest limits. Try again.",
      "limit_check_failed",
      503,
    );
  }
  if (count >= limit) {
    return subscriptionAccessDenied(
      `Basic plan includes ${limit} backtests per month. Upgrade to Advanced for unlimited backtests.`,
      "backtest_monthly_limit",
    );
  }
  return null;
}

export async function assertTelegramChannelLimit(
  supabase: SupabaseClient,
  userId: string,
  sub: UserSubscriptionRow | null,
  options: PlanLimitCountOptions = {},
): Promise<Response | null> {
  if (await loadUserIsAdmin(supabase, userId)) return null;

  let plan = effectivePlan(sub?.plan, sub?.status, sub?.trial_ends_at);
  if (!plan && (await hasLiveSubscriptionExtension(supabase, userId, sub))) {
    // A live admin extension grants Advanced while it is the reason access is alive.
    plan = "advanced";
  }
  if (!plan) {
    return subscriptionAccessDenied(
      "An active subscription is required to add Telegram channels.",
      "subscription_required",
    );
  }
  const limit = maxTelegramChannels(plan);
  if (limit == null) return null;
  const slotsNeeded = options.slotsNeeded ?? 1;
  if (slotsNeeded <= 0) return null;
  const { data, error } = await supabase
    .from("telegram_channels")
    .select("id, source_kind")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error || !data) {
    console.warn(
      `[subscriptionAccess] channel limit count failed for ${userId}: ${error?.message ?? "null data"}`,
    );
    return subscriptionAccessDenied(
      "Unable to verify Telegram channel limits. Try again.",
      "limit_check_failed",
      503,
    );
  }
  const exclude = new Set((options.excludeRowIds ?? []).filter(Boolean));
  const count = data.reduce((n, row) => {
    if (exclude.has(row.id)) return n;
    if ((row as { source_kind?: string | null }).source_kind === "tradingview") return n;
    return n + 1;
  }, 0);
  if (count + slotsNeeded > limit) {
    return subscriptionAccessDenied(
      `Basic plan includes ${limit} Telegram channels. Upgrade to Advanced for unlimited channels.`,
      "channel_limit",
    );
  }
  return null;
}

export { isSubscriptionActive, effectivePlan };

/**
 * Derive why the copier should be paused, from the local subscriptions row.
 * Used by revokeCopierAccessOnSubscriptionEnd so every billing-driven pause
 * stores a reason the admin dashboard can break down.
 * Returns null only when the query itself fails, so the caller can leave
 * copier_pause_reason unset for a later backfill instead of persisting a wrong
 * terminal label. A missing subscriptions row (user never subscribed) is a
 * legitimate "unknown".
 */
export async function deriveCopierPauseReason(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn(
      `[subscriptionAccess] pause-reason derivation failed for ${userId}: ${error.message}`,
    );
    return null;
  }
  const status = String(data?.status ?? "");
  if (status === "past_due") return "payment_failed";
  if (
    status === "trialing" &&
    data?.trial_ends_at &&
    new Date(data.trial_ends_at).getTime() < Date.now()
  ) {
    return "trial_expired";
  }
  if (status === "canceled") return "subscription_ended";
  return "unknown";
}

/** Pause copier and drop listener lease when subscription is no longer active. */
export async function revokeCopierAccessOnSubscriptionEnd(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  if (await loadUserIsAdmin(supabase, userId)) return

  // A live admin extension outranks billing: keep the copier running until it ends.
  const sub = await loadUserSubscription(supabase, userId)
  if (await hasLiveSubscriptionExtension(supabase, userId, sub)) return

  // Only on the pause transition: a copier the user already paused keeps its
  // own reason instead of being relabelled by a later billing event.
  const reason = await deriveCopierPauseReason(supabase, userId)
  const pausePatch: Record<string, unknown> = { copier_paused: true }
  if (reason) pausePatch.copier_pause_reason = reason
  const { error: pauseErr } = await supabase
    .from("user_profiles")
    .update(pausePatch)
    .eq("user_id", userId)
    .eq("copier_paused", false)
  if (pauseErr) {
    console.warn(
      `[subscriptionAccess] copier_paused update failed for ${userId}: ${pauseErr.message}`,
    )
  }

  const { error: leaseErr } = await supabase
    .from("worker_session_leases")
    .delete()
    .eq("user_id", userId)
  if (leaseErr) {
    console.warn(
      `[subscriptionAccess] lease delete failed for ${userId}: ${leaseErr.message}`,
    )
  }
}

/** Clear subscription-induced pause when billing is active again. */
export async function restoreCopierAccessOnSubscriptionActive(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  if (await loadUserIsAdmin(supabase, userId)) return

  const { error } = await supabase
    .from("user_profiles")
    .update({ copier_paused: false, copier_pause_reason: null })
    .eq("user_id", userId)
  if (error) {
    console.warn(
      `[subscriptionAccess] copier_paused restore failed for ${userId}: ${error.message}`,
    )
    return
  }
  console.log(`[subscriptionAccess] restored copier access for ${userId}`)
}
