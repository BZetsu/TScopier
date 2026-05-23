import { useMemo } from 'react'
import { useLocale } from '../context/LocaleContext'
import { useUserProfile } from '../context/UserProfileContext'
import { formatMoneyAmount, type FormatMoneyOptions } from '../lib/currency'

export function useFormatMoney() {
  const { baseCurrency } = useUserProfile()
  const { locale } = useLocale()

  return useMemo(() => {
    const intlLocale = locale === 'en' ? undefined : locale
    const withLocale = (options?: FormatMoneyOptions): FormatMoneyOptions => ({
      locale: intlLocale,
      ...options,
    })
    return {
      baseCurrency,
      formatMoney: (value: number | null | undefined, options?: FormatMoneyOptions) =>
        formatMoneyAmount(value, baseCurrency, withLocale(options)),
      formatAxisMoney: (value: number) =>
        formatMoneyAmount(value, baseCurrency, withLocale({ compact: true, nullAsDash: false })),
      formatSignedMoney: (value: number | null | undefined) =>
        formatMoneyAmount(value, baseCurrency, withLocale({ signed: true })),
    }
  }, [baseCurrency, locale])
}
