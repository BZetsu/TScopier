import { LOCALE_STORAGE_KEY } from '../i18n/types'

/**
 * Support chat may use Turkish even when the product interface does not yet
 * have a Turkish bundle. Keep this list aligned with the Edge Function's
 * SUPPORT_LOCALES contract.
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
 * product locale. This lets Turkish browsers use Turkish support chat while
 * the rest of the product safely remains in English.
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
