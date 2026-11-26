import type { Translations } from '../i18n/locales/types'
import type { CheckoutCopy } from '../components/billing/CheckoutPaymentStep'

export function checkoutCopyFromT(t: Translations): CheckoutCopy {
  const bt = t.pricing.billing
  return {
    checkoutBadge: bt.checkoutBadge,
    subscribeTo: bt.subscribeTo,
    howToPay: bt.howToPay,
    cardTitle: bt.payCardTitle,
    cardDescription: bt.payCardDescription,
    cardFooter: bt.payCardFooter,
    cryptoTitle: bt.payCryptoTitle,
    cryptoDescription: bt.payCryptoDescription,
    cryptoFooter: bt.payCryptoFooter,
    addPromo: bt.addPromoCode,
    promoPlaceholder: bt.promoPlaceholder,
    applyPromo: bt.applyPromo,
    continueCheckout: bt.continueCheckout,
    backToPlans: bt.backToPlans,
    perMonth: t.pricing.perMonth,
    perYear: t.pricing.perYear,
    basicName: t.pricing.basic.name,
    advancedName: t.pricing.advanced.name,
  }
}

export function formatCheckoutPriceLabel(
  interval: 'monthly' | 'annual',
  amount: number,
  perMonth: string,
  perYear: string,
): string {
  if (interval === 'annual') return `$${amount.toFixed(2)}${perYear}`
  return `$${amount.toFixed(2)}${perMonth}`
}
