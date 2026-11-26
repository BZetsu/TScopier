/** UniCopier / support desk locale codes. */
export const SUPPORT_LOCALES = [
  "en",
  "es",
  "fr",
  "pl",
  "ru",
  "sv",
  "nl",
  "ja",
  "ar",
  "de",
  "tr",
] as const;

export type SupportLocale = (typeof SUPPORT_LOCALES)[number];

const LOCALE_LANGUAGES: Record<SupportLocale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  pl: "Polish",
  ru: "Russian",
  sv: "Swedish",
  nl: "Dutch",
  ja: "Japanese",
  ar: "Arabic",
  de: "German",
  tr: "Turkish",
};

const LOCALE_ALIASES: Record<string, SupportLocale> = {
  turkish: "tr",
  turkce: "tr",
  "türkçe": "tr",
};

export function isSupportLocale(value: string | null | undefined): value is SupportLocale {
  return SUPPORT_LOCALES.includes(value as SupportLocale);
}

/** Parse a locale without treating a regional tag or language name as English. */
export function parseSupportLocale(raw?: string | null): SupportLocale | null {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const primary = normalized.split(/[-_\s.]/)[0]?.slice(0, 8) ?? "";
  if (isSupportLocale(primary)) return primary;
  return LOCALE_ALIASES[primary] ?? null;
}

export function normalizeSupportLocale(raw?: string | null): SupportLocale {
  return parseSupportLocale(raw) ?? "en";
}

export function supportLocaleLanguage(locale: SupportLocale): string {
  return LOCALE_LANGUAGES[locale] ?? "English";
}

/** Appended so support AI replies match the customer's support-chat language. */
export function supportReplyLanguageAddon(localeRaw?: string | null): string {
  const locale = normalizeSupportLocale(localeRaw);
  const language = supportLocaleLanguage(locale);
  if (locale === "en") {
    return `

## Reply language
Reply in clear, everyday English. If the user writes in another language, match their language.`;
  }
  return `

## Reply language
The customer's support-chat language is **${language}** (locale \`${locale}\`). Always reply in **${language}**. Keep product names (UniCopier, MetaTrader, etc.) untranslated.`;
}

export type TranslationMap = Record<string, string>;

export function readCachedTranslation(
  translations: unknown,
  locale: SupportLocale,
): string | null {
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
    return null;
  }
  const value = (translations as Record<string, unknown>)[locale];
  return typeof value === "string" && value.trim() ? value : null;
}

export function resolveMessageText(params: {
  body: string;
  sourceLocale: string | null | undefined;
  translations: unknown;
  viewerLocale: string | null | undefined;
}): { text: string; isTranslated: boolean; sourceLocale: SupportLocale } {
  const sourceLocale = normalizeSupportLocale(params.sourceLocale);
  const viewerLocale = normalizeSupportLocale(params.viewerLocale);
  if (viewerLocale === sourceLocale) {
    return { text: params.body, isTranslated: false, sourceLocale };
  }
  const cached = readCachedTranslation(params.translations, viewerLocale);
  if (cached) {
    return { text: cached, isTranslated: true, sourceLocale };
  }
  return { text: params.body, isTranslated: false, sourceLocale };
}
