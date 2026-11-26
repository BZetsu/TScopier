import type { Locale } from '../types'
import { channelWorkerEn } from './en'
import { channelWorkerEs } from './es'
import { channelWorkerFr } from './fr'
import { channelWorkerAr } from './ar'
import { channelWorkerJa } from './ja'
import { channelWorkerNl } from './nl'
import { channelWorkerPl } from './pl'
import { channelWorkerRu } from './ru'
import { channelWorkerSv } from './sv'
import type { ChannelWorkerTranslations } from './types'

const byLocale: Record<Locale, ChannelWorkerTranslations> = {
  en: channelWorkerEn,
  es: channelWorkerEs,
  fr: channelWorkerFr,
  // No German/Portuguese/Italian bundle yet: these worker-facing labels stay
  // in English.
  de: channelWorkerEn,
  pt: channelWorkerEn,
  it: channelWorkerEn,
  pl: channelWorkerPl,
  ru: channelWorkerRu,
  sv: channelWorkerSv,
  nl: channelWorkerNl,
  ja: channelWorkerJa,
  ar: channelWorkerAr,
}

export function getChannelWorkerTranslations(locale: Locale): ChannelWorkerTranslations {
  return byLocale[locale] ?? channelWorkerEn
}

export type { ChannelWorkerTranslations }
