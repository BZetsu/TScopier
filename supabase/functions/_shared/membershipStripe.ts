import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17";

export const stripeApiVersion = "2024-12-18.acacia" as const;

export type MembershipPlan = "basic" | "advanced";
export type BillingInterval = "monthly" | "annual";

export type MembershipSubRow = {
  stripe_customer_id: string | null;
  trial_ends_at: string | null;
  plan: string | null;
  status: string | null;
  stripe_subscription_id: string | null;
};

export function membershipPriceIdsFromEnv() {
  const ids = (key: string) => String(Deno.env.get(key) ?? "").trim();
  return {
    basicMonthly: ids("STRIPE_BASIC_PRICE_ID"),
    advancedMonthly: ids("STRIPE_ADVANCED_PRICE_ID"),
    extraMonthly: ids("STRIPE_EXTRA_ACCOUNT_PRICE_ID"),
    basicAnnual: ids("STRIPE_BASIC_ANNUAL_PRICE_ID"),
    advancedAnnual: ids("STRIPE_ADVANCED_ANNUAL_PRICE_ID"),
    extraAnnual: ids("STRIPE_EXTRA_ACCOUNT_ANNUAL_PRICE_ID"),
  };
}

export function requireMembershipPriceId(
  plan: MembershipPlan,
  billingInterval: BillingInterval,
): { priceId: string } | { error: string } {
  const prices = membershipPriceIdsFromEnv();
  const annual = billingInterval === "annual";
  const priceId =
    plan === "basic"
      ? annual
        ? prices.basicAnnual
        : prices.basicMonthly
      : annual
        ? prices.advancedAnnual
        : prices.advancedMonthly;
  if (!priceId) {
    const key =
      plan === "basic"
        ? annual
          ? "STRIPE_BASIC_ANNUAL_PRICE_ID"
          : "STRIPE_BASIC_PRICE_ID"
        : annual
          ? "STRIPE_ADVANCED_ANNUAL_PRICE_ID"
          : "STRIPE_ADVANCED_PRICE_ID";
    return {
      error: `Stripe price not configured (${key}). Set this secret on the Supabase project and redeploy checkout.`,
    };
  }
  return { priceId };
}

/** Stablecoin/crypto Checkout requires USD line items. */
export async function assertMembershipPricesUsd(
  stripe: Stripe,
  plan: MembershipPlan,
  billingInterval: BillingInterval,
  extraAccounts: number,
): Promise<void> {
  const items = buildMembershipLineItems(plan, billingInterval, extraAccounts);
  for (const item of items) {
    const priceId = String(item.price ?? "");
    if (!priceId) continue;
    const price = await stripe.prices.retrieve(priceId);
    if (String(price.currency || "").toLowerCase() !== "usd") {
      throw new Error(
        `Stripe price ${priceId} is ${price.currency}, not usd. Stablecoin/crypto checkout requires USD prices.`,
      );
    }
  }
}

export function buildMembershipLineItems(
  plan: MembershipPlan,
  billingInterval: BillingInterval,
  extraAccounts: number,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const prices = membershipPriceIdsFromEnv();
  const annual = billingInterval === "annual";
  const required = requireMembershipPriceId(plan, billingInterval);
  if ("error" in required) {
    throw new Error(required.error);
  }
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: required.priceId, quantity: 1 },
  ];
  if (plan === "advanced") {
    const extra = Math.max(0, Math.min(95, Number(extraAccounts) || 0));
    if (extra > 0) {
      const extraPrice = annual ? prices.extraAnnual : prices.extraMonthly;
      if (!extraPrice) {
        throw new Error(
          `Stripe price not configured (${annual ? "STRIPE_EXTRA_ACCOUNT_ANNUAL_PRICE_ID" : "STRIPE_EXTRA_ACCOUNT_PRICE_ID"}).`,
        );
      }
      items.push({ price: extraPrice, quantity: extra });
    }
  }
  return items;
}

export function buildSubscriptionItems(
  plan: MembershipPlan,
  billingInterval: BillingInterval,
  extraAccounts: number,
): Stripe.SubscriptionCreateParams.Item[] {
  return buildMembershipLineItems(plan, billingInterval, extraAccounts).map((li) => ({
    price: String(li.price),
    quantity: li.quantity ?? 1,
  }));
}

export function guardExistingMembership(
  existingSub: MembershipSubRow | null | undefined,
  plan: MembershipPlan,
): { code: string; message: string } | null {
  const existingPlan = existingSub?.plan;
  const existingStatus = existingSub?.status;
  const hasActiveAdvanced =
    existingPlan === "advanced" &&
    (existingStatus === "active" || existingStatus === "trialing" || existingStatus === "past_due");
  if (hasActiveAdvanced && plan === "basic") {
    return {
      code: "advanced_already_active",
      message:
        "You already have an active Advanced subscription. Manage billing from the customer portal instead of starting Basic.",
    };
  }
  if (
    existingPlan === "basic" &&
    (existingStatus === "active" || existingStatus === "trialing" || existingStatus === "past_due") &&
    plan === "basic" &&
    existingSub?.stripe_subscription_id
  ) {
    return {
      code: "basic_already_active",
      message: "You already have an active Basic subscription. Manage billing from the customer portal.",
    };
  }
  return null;
}

export async function ensureStripeCustomer(params: {
  stripe: Stripe;
  supabase: SupabaseClient;
  user: { id: string; email?: string | null };
  existingSub: MembershipSubRow | null | undefined;
  plan: MembershipPlan;
}): Promise<string> {
  const { stripe, supabase, user, existingSub, plan } = params;
  let customerId = existingSub?.stripe_customer_id ?? null;
  if (customerId) return customerId;

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { supabase_user_id: user.id },
  });
  customerId = customer.id;
  if (!existingSub) {
    await supabase.from("subscriptions").insert({
      user_id: user.id,
      stripe_customer_id: customerId,
      plan,
      status: "incomplete",
    });
  } else {
    await supabase
      .from("subscriptions")
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }
  return customerId;
}

export async function resolvePromotionCodeId(
  stripe: Stripe,
  code: string | null | undefined,
): Promise<{ promotionCodeId?: string; error?: string }> {
  const raw = String(code ?? "").trim();
  if (!raw) return {};
  const listed = await stripe.promotionCodes.list({
    code: raw,
    active: true,
    limit: 1,
  });
  const found = listed.data[0];
  if (!found?.id) {
    return { error: "Invalid or inactive promotion code" };
  }
  return { promotionCodeId: found.id };
}

export function membershipMetadata(
  userId: string,
  plan: MembershipPlan,
  billingInterval: BillingInterval,
  extraAccounts: number,
): Record<string, string> {
  return {
    supabase_user_id: userId,
    plan,
    interval: billingInterval,
    extra_accounts: String(extraAccounts || 0),
  };
}

/** Crypto Checkout is mode=payment (manual renew). Recurring prices cannot be used. */
export async function buildCryptoPaymentLineItems(
  stripe: Stripe,
  plan: MembershipPlan,
  billingInterval: BillingInterval,
  extraAccounts: number,
): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
  const recurring = buildMembershipLineItems(plan, billingInterval, extraAccounts);
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const li of recurring) {
    const priceId = String(li.price ?? "");
    const price = await stripe.prices.retrieve(priceId);
    if (String(price.currency || "").toLowerCase() !== "usd") {
      throw new Error(
        `Stripe price ${priceId} is ${price.currency}, not usd. Crypto checkout requires USD.`,
      );
    }
    if (price.unit_amount == null) {
      throw new Error(`Stripe price ${priceId} has no unit_amount`);
    }
    const product =
      typeof price.product === "string" ? price.product : price.product?.id;
    if (!product) {
      throw new Error(`Stripe price ${priceId} has no product`);
    }
    items.push({
      quantity: li.quantity ?? 1,
      price_data: {
        currency: "usd",
        unit_amount: price.unit_amount,
        product,
      },
    });
  }
  return items;
}

export function membershipPeriodEndIso(
  billingInterval: BillingInterval,
  from: Date = new Date(),
): string {
  const d = new Date(from.getTime());
  if (billingInterval === "annual") {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString();
}

export function parseMembershipCryptoMeta(meta: Record<string, string> | null | undefined): {
  userId: string;
  plan: MembershipPlan;
  interval: BillingInterval;
  extraAccounts: number;
} | null {
  if (!meta || String(meta.checkout_kind ?? "") !== "membership_crypto") return null;
  const userId = String(meta.supabase_user_id ?? "").trim();
  const planRaw = String(meta.plan ?? "").toLowerCase();
  const plan: MembershipPlan | null =
    planRaw === "basic" || planRaw === "advanced" ? planRaw : null;
  if (!userId || !plan) return null;
  const interval: BillingInterval =
    String(meta.interval ?? "").toLowerCase() === "annual" ? "annual" : "monthly";
  const extraAccounts = Math.max(
    0,
    Math.min(95, Math.floor(Number(meta.extra_accounts ?? 0) || 0)),
  );
  return { userId, plan, interval, extraAccounts };
}

/** Grant / extend local entitlement after a paid crypto (mode=payment) Checkout. */
export async function upsertMembershipCryptoEntitlement(params: {
  supabase: SupabaseClient;
  userId: string;
  customerId: string | null;
  plan: MembershipPlan;
  billingInterval: BillingInterval;
  extraAccounts: number;
  /** If still active, stack the new period onto the existing end. */
  existingPeriodEnd?: string | null;
}): Promise<{
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: null;
  plan: MembershipPlan;
  status: "active";
  extra_accounts: number;
  trial_ends_at: null;
  current_period_end: string;
  canceled_at: null;
  updated_at: string;
}> {
  const {
    supabase,
    userId,
    customerId,
    plan,
    billingInterval,
    extraAccounts,
    existingPeriodEnd,
  } = params;

  let from = new Date();
  if (existingPeriodEnd) {
    const prev = new Date(existingPeriodEnd);
    if (!Number.isNaN(prev.getTime()) && prev.getTime() > from.getTime()) {
      from = prev;
    }
  }
  const currentPeriodEnd = membershipPeriodEndIso(billingInterval, from);
  const row = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: null as null,
    plan,
    status: "active" as const,
    extra_accounts: plan === "advanced" ? extraAccounts : 0,
    trial_ends_at: null as null,
    current_period_end: currentPeriodEnd,
    canceled_at: null as null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id", ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  return row;
}
