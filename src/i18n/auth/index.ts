import type { Locale } from '../types'
import { authEn } from './en'
import type { AuthTranslations } from './types'
import { authEs } from './es'
import { authFr } from './fr'
import { authAr } from './ar'
import { authJa } from './ja'
import { authNl } from './nl'
import { authPl } from './pl'
import { authRu } from './ru'
import { authSv } from './sv'
import { authDe } from './de'
import { authTr } from './tr'

const byLocale: Record<Locale, AuthTranslations> = {
  en: authEn,
  es: authEs,
  fr: authFr,
  // No Portuguese/Italian auth bundle yet: the sign-in/sign-up screens
  // stay in English until one exists. getAuthTranslations also falls back.
  de: authDe,
  pt: authEn,
  it: authEn,
  pl: authPl,
  ru: authRu,
  sv: authSv,
  nl: authNl,
  ja: authJa,
  ar: authAr,
  tr: authTr,
}

export function getAuthTranslations(locale: Locale): AuthTranslations {
  return byLocale[locale] ?? authEn
}

export type { AuthTranslations }
