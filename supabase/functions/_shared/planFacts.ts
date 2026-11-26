import { PLAN_LIMITS } from "./planLimits.ts";

/**
 * Canonical plan prices and limits shared by the product UI and customer-facing
 * assistants. Keep these values aligned with the billing product; no price or
 * entitlement behavior is derived from this module.
 */
export const PLAN_MONTHLY_PRICES = {
  basic: 9.99,
  advanced: 39.99,
  extraAccount: 10,
} as const;

export const PLAN_FACTS = {
  basic: {
    name: "Basic",
    monthlyPrice: PLAN_MONTHLY_PRICES.basic,
    monthlyPriceLabel: `$${PLAN_MONTHLY_PRICES.basic.toFixed(2)}/month`,
    maxBrokerAccounts: PLAN_LIMITS.basic.maxBrokerAccounts,
    maxTelegramChannels: PLAN_LIMITS.basic.maxTelegramChannels,
    maxBacktestsPerMonth: PLAN_LIMITS.basic.maxBacktestsPerMonth,
    maxTpRows: PLAN_LIMITS.basic.maxTpRows,
  },
  advanced: {
    name: "Advanced",
    monthlyPrice: PLAN_MONTHLY_PRICES.advanced,
    monthlyPriceLabel: `$${PLAN_MONTHLY_PRICES.advanced.toFixed(2)}/month`,
    includedBrokerAccounts: PLAN_LIMITS.advanced.maxBrokerAccountsBase,
    maximumBrokerAccounts: PLAN_LIMITS.advanced.maxBrokerAccountsBase +
      PLAN_LIMITS.advanced.maxBrokerAccountsExtra,
    maxTelegramChannels: PLAN_LIMITS.advanced.maxTelegramChannels,
    maxBacktestsPerMonth: PLAN_LIMITS.advanced.maxBacktestsPerMonth,
    maxTpRows: PLAN_LIMITS.advanced.maxTpRows,
  },
} as const;

export const PLAN_FACTS_VERSION = "plan-facts-v2026-11-25";
