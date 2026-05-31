export const PRICING_MONTHLY_BASIC = 9.99
export const PRICING_MONTHLY_ADVANCED = 39.99
export const PRICING_MONTHLY_EXTRA_ACCOUNT = 10

export const PRICING_ANNUAL_BASIC = +(PRICING_MONTHLY_BASIC * 12 * 0.8).toFixed(2)
export const PRICING_ANNUAL_ADVANCED = +(PRICING_MONTHLY_ADVANCED * 12 * 0.8).toFixed(2)
export const PRICING_ANNUAL_EXTRA_ACCOUNT = +(PRICING_MONTHLY_EXTRA_ACCOUNT * 12 * 0.8).toFixed(2)

export const PRICING_ADVANCED_INCLUDED_ACCOUNTS = 5

export function pricingDisplayPrices(
  interval: 'monthly' | 'annual',
  extraAccounts: number,
): {
  basicMonthly: number
  basicAnnualTotal: number
  advancedMonthly: number
  advancedAnnualTotal: number
  extraAccountMonthly: number
} {
  const isAnnual = interval === 'annual'
  const basicMonthly = isAnnual ? +(PRICING_ANNUAL_BASIC / 12).toFixed(2) : PRICING_MONTHLY_BASIC
  const advancedBase = isAnnual ? +(PRICING_ANNUAL_ADVANCED / 12).toFixed(2) : PRICING_MONTHLY_ADVANCED
  const extraAccountMonthly = isAnnual
    ? +(PRICING_ANNUAL_EXTRA_ACCOUNT / 12).toFixed(2)
    : PRICING_MONTHLY_EXTRA_ACCOUNT

  return {
    basicMonthly,
    basicAnnualTotal: PRICING_ANNUAL_BASIC,
    advancedMonthly: advancedBase + extraAccounts * extraAccountMonthly,
    advancedAnnualTotal: PRICING_ANNUAL_ADVANCED + extraAccounts * PRICING_ANNUAL_EXTRA_ACCOUNT,
    extraAccountMonthly,
  }
}

/** Total saved vs paying monthly for 12 months. */
export function annualSavingsVsMonthly(monthlyRate: number, annualTotal: number): number {
  return Math.max(0, +(monthlyRate * 12 - annualTotal).toFixed(2))
}

export function billingTablePrices(extraAccounts: number) {
  const monthly = pricingDisplayPrices('monthly', extraAccounts)
  const annual = pricingDisplayPrices('annual', extraAccounts)
  return {
    basic: {
      monthly: monthly.basicMonthly,
      annualTotal: annual.basicAnnualTotal,
      annualPerMonth: annual.basicMonthly,
      annualSavings: annualSavingsVsMonthly(PRICING_MONTHLY_BASIC, PRICING_ANNUAL_BASIC),
    },
    advanced: {
      monthly: monthly.advancedMonthly,
      annualTotal: annual.advancedAnnualTotal,
      annualPerMonth: annual.advancedMonthly,
      annualSavings: annualSavingsVsMonthly(
        PRICING_MONTHLY_ADVANCED + extraAccounts * PRICING_MONTHLY_EXTRA_ACCOUNT,
        PRICING_ANNUAL_ADVANCED + extraAccounts * PRICING_ANNUAL_EXTRA_ACCOUNT,
      ),
    },
  }
}
