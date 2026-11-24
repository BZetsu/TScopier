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
