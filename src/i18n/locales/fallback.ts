import type { Locale } from '../types'

const ENGLISH_FALLBACK_LOCALES: ReadonlySet<Locale> = new Set(['de', 'pt', 'it', 'pl', 'ru', 'sv', 'nl', 'ja'])

export function localeUsesEnglishFallback(locale: Locale): boolean {
  return ENGLISH_FALLBACK_LOCALES.has(locale)
}
