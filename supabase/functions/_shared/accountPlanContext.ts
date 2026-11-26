import {
  effectivePlan,
  maxBacktestsPerMonth,
  maxBrokerAccounts,
  maxTelegramChannels,
  maxTpRows,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "./planLimits.ts";

export type AccountPlanAccess = "active" | "extension" | "admin" | "inactive";

export type AccountPlanLimits = {
  /** "basic" and "advanced" are subscription limits; "admin" is an unlimited bypass. */
  source: "basic" | "advanced" | "admin";
  /** A null numeric limit means unlimited. */
  max_broker_accounts: number | null;
  max_telegram_channels: number | null;
  max_backtests_per_month: number | null;
  max_tp_rows: number | null;
};

export type AccountPlanContext = {
  subscription_plan: SubscriptionPlan | null;
  subscription_status: SubscriptionStatus | null;
  effective_plan: SubscriptionPlan | null;
  access: AccountPlanAccess;
  limits: AccountPlanLimits | null;
};

export type AccountPlanContextInput = {
  plan?: unknown;
  status?: unknown;
  trialEndsAt?: unknown;
  extraAccounts?: unknown;
  isAdmin?: boolean;
  hasLiveExtension?: boolean;
};

function normalizePlan(value: unknown): SubscriptionPlan | null {
  const plan = String(value ?? "").trim().toLowerCase();
  return plan === "basic" || plan === "advanced" ? plan : null;
}

function normalizeStatus(value: unknown): SubscriptionStatus | null {
  const status = String(value ?? "").trim().toLowerCase();
  if (
    status === "active" ||
    status === "trialing" ||
    status === "canceled" ||
    status === "past_due" ||
    status === "incomplete"
  ) {
    return status;
  }
  return null;
}

function normalizeTrialEndsAt(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function normalizeExtraAccounts(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

/**
 * Resolve the plan and limits that apply to one account.
 *
 * This is deliberately pure so both customer-facing assistants use exactly the
 * same calculation. The caller supplies the authenticated account state; this
 * function never accepts a user id and never reads or writes the database.
 */
export function buildAccountPlanContext(
  input: AccountPlanContextInput,
): AccountPlanContext {
  const subscriptionPlan = normalizePlan(input.plan);
  const subscriptionStatus = normalizeStatus(input.status);
  const trialEndsAt = normalizeTrialEndsAt(input.trialEndsAt);
  const extraAccounts = normalizeExtraAccounts(input.extraAccounts);

  if (input.isAdmin === true) {
    return {
      subscription_plan: subscriptionPlan,
      subscription_status: subscriptionStatus,
      effective_plan: "advanced",
      access: "admin",
      limits: {
        source: "admin",
        max_broker_accounts: null,
        max_telegram_channels: null,
        max_backtests_per_month: null,
        max_tp_rows: null,
      },
    };
  }

  let activePlan = effectivePlan(
    subscriptionPlan,
    subscriptionStatus,
    trialEndsAt,
  );
  let access: AccountPlanAccess = activePlan ? "active" : "inactive";

  if (!activePlan && input.hasLiveExtension === true) {
    activePlan = "advanced";
    access = "extension";
  }

  if (!activePlan) {
    return {
      subscription_plan: subscriptionPlan,
      subscription_status: subscriptionStatus,
      effective_plan: null,
      access,
      limits: null,
    };
  }

  return {
    subscription_plan: subscriptionPlan,
    subscription_status: subscriptionStatus,
    effective_plan: activePlan,
    access,
    limits: {
      source: activePlan,
      max_broker_accounts: maxBrokerAccounts(activePlan, extraAccounts),
      max_telegram_channels: maxTelegramChannels(activePlan),
      max_backtests_per_month: maxBacktestsPerMonth(activePlan),
      max_tp_rows: maxTpRows(activePlan),
    },
  };
}
