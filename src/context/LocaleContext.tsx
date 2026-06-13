import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getTranslations, loadTranslations } from '../i18n/locales'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '../i18n/types'
import { LocaleContext } from './localeContextInstance'

function detectBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null
  const lang = navigator.language.split('-')[0]?.toLowerCase()
  if (lang === 'en' || lang === 'es' || lang === 'fr') return lang
  return null
}

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw === 'en' || raw === 'es' || raw === 'fr') return raw
  } catch {
    /* private mode */
  }
  return detectBrowserLocale() ?? DEFAULT_LOCALE
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())
  const [t, setT] = useState(() => getTranslations(locale))

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    let cancelled = false
    void loadTranslations(locale).then(translations => {
      if (!cancelled) setT(translations)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      auth: t.auth,
    }),
    [locale, setLocale, t],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

/** Shorthand for `useLocale().t` */
export function useT() {
  return useLocale().t
}
