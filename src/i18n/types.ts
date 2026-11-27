export type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'pl' | 'ru' | 'sv' | 'nl' | 'ja' | 'ar' | 'tr'

export type LocaleOption = {
  code: Locale
  label: string
  short: string
  /** ISO 3166-1 alpha-2 id in `public/flags.svg` (country flag, not language code). */
  flagId: string
  searchText: string
}

const LOCALE_CODES: readonly Locale[] = [
  'en', 'es', 'fr', 'de', 'pt', 'it', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar', 'tr',
] as const

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALE_CODES.includes(value as Locale)
}

export const LOCALES: LocaleOption[] = [
  {
    code: 'en',
    label: 'English',
    short: 'EN',
    flagId: 'us',
    searchText: 'english en us usa united states america',
  },
  {
    code: 'es',
    label: 'Español',
    short: 'ES',
    flagId: 'es',
    searchText: 'spanish espanol españa spain',
  },
  {
    code: 'fr',
    label: 'Français',
    short: 'FR',
    flagId: 'fr',
    searchText: 'french francais france',
  },
  {
    code: 'de',
    label: 'Deutsch',
    short: 'DE',
    flagId: 'de',
    searchText: 'german deutsch deutschland germany',
  },
  {
    code: 'pt',
    label: 'Português',
    short: 'PT',
    flagId: 'pt',
    searchText: 'portuguese portugues portugal brasil brazil',
  },
  {
    code: 'it',
    label: 'Italiano',
    short: 'IT',
    flagId: 'it',
    searchText: 'italian italiano italia italy',
  },
  {
    code: 'pl',
    label: 'Polski',
    short: 'PL',
    flagId: 'pl',
    searchText: 'polish polski poland polska',
  },
  {
    code: 'ru',
    label: 'Русский',
    short: 'RU',
    flagId: 'ru',
    searchText: 'russian russkiy russia',
  },
  {
    code: 'sv',
    label: 'Svenska',
    short: 'SV',
    flagId: 'se',
    searchText: 'swedish svenska sweden',
  },
  {
    code: 'nl',
    label: 'Nederlands',
    short: 'NL',
    flagId: 'nl',
    searchText: 'dutch nederlands netherlands holland',
  },
  {
    code: 'ja',
    label: '日本語',
    short: 'JA',
    flagId: 'jp',
    searchText: 'japanese nihongo japan jap',
  },
  {
    code: 'ar',
    label: 'العربية',
    short: 'AR',
    flagId: 'sa',
    searchText: 'arabic arabic msa saudi arabia middle east',
  },
  {
    code: 'tr',
    label: 'Türkçe',
    short: 'TR',
    flagId: 'tr',
    searchText: 'turkish turkce türkiye turkey istanbul',
  },
]

export const RTL_LOCALES: readonly Locale[] = ['ar']

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale)
}

export function localeDirection(locale: Locale): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr'
}

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_STORAGE_KEY = 'tscopier-locale'

/**
 * BCP 47 tags for date and number formatting. Locales without an entry fall
 * back to the bare locale code (itself a valid BCP 47 tag) or to the caller's
 * default, so this map only pins the tags where a region matters.
 */
export const LOCALE_DATE_TAGS: Partial<Record<Locale, string>> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  tr: 'tr-TR',
}

/** Case- and diacritic-insensitive substring match for language picker search. */
export function normalizeLocaleSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

export function filterLocales(query: string, locales: readonly LocaleOption[] = LOCALES): LocaleOption[] {
  const normalized = normalizeLocaleSearchText(query)
  if (!normalized) return [...locales]
  return locales.filter(opt => {
    const haystack = normalizeLocaleSearchText(
      `${opt.label} ${opt.short} ${opt.code} ${opt.searchText}`,
    )
    return haystack.includes(normalized)
  })
}
