import { LOCALE_STORAGE_KEY } from '../i18n/types'

/**
 * Support chat accepts German and Turkish, matching the full product-interface
 * bundles. Keep this list aligned with the Edge Function's SUPPORT_LOCALES
 * contract.
 */
export const SUPPORT_CHAT_LOCALES = [
  'en',
  'es',
  'fr',
  'pl',
  'ru',
  'sv',
  'nl',
  'ja',
  'ar',
  'de',
  'tr',
] as const

export type SupportChatLocale = (typeof SUPPORT_CHAT_LOCALES)[number]

function parseSupportChatLocale(raw?: string | null): SupportChatLocale | null {
  const normalized = String(raw ?? '').trim().toLowerCase()
  if (!normalized) return null
  const primary = normalized.split(/[-_\s.]/)[0] ?? ''
  return SUPPORT_CHAT_LOCALES.includes(primary as SupportChatLocale)
    ? (primary as SupportChatLocale)
    : null
}

export function normalizeSupportChatLocale(raw?: string | null): SupportChatLocale {
  return parseSupportChatLocale(raw) ?? 'en'
}

/**
 * A stored product choice wins, then the browser language, then the active
 * product locale, so support chat follows the language the product UI is
 * showing — or the browser language when the product locale is English.
 */
export function resolveSupportChatLocale(params: {
  uiLocale?: string | null
  browserLocale?: string | null
  storedLocale?: string | null
}): SupportChatLocale {
  return (
    parseSupportChatLocale(params.storedLocale) ??
    parseSupportChatLocale(params.browserLocale) ??
    parseSupportChatLocale(params.uiLocale) ??
    'en'
  )
}

function readStoredSupportLocale(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

function readBrowserSupportLocale(): string | null {
  if (typeof navigator === 'undefined') return null
  return navigator.language
}

export function currentSupportChatLocale(uiLocale: string): SupportChatLocale {
  return resolveSupportChatLocale({
    uiLocale,
    browserLocale: readBrowserSupportLocale(),
    storedLocale: readStoredSupportLocale(),
  })
}
