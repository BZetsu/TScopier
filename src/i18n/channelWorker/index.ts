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
import { channelWorkerDe } from './de'
import { channelWorkerTr } from './tr'
import type { ChannelWorkerTranslations } from './types'

const byLocale: Record<Locale, ChannelWorkerTranslations> = {
  en: channelWorkerEn,
  es: channelWorkerEs,
  fr: channelWorkerFr,
  // No Portuguese/Italian bundle yet: these worker-facing labels stay
  // in English.
  de: channelWorkerDe,
  pt: channelWorkerEn,
  it: channelWorkerEn,
  pl: channelWorkerPl,
  ru: channelWorkerRu,
  sv: channelWorkerSv,
  nl: channelWorkerNl,
  ja: channelWorkerJa,
  ar: channelWorkerAr,
  tr: channelWorkerTr,
}

export function getChannelWorkerTranslations(locale: Locale): ChannelWorkerTranslations {
  return byLocale[locale] ?? channelWorkerEn
}

export type { ChannelWorkerTranslations }
