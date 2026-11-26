import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  SUPPORT_LOCALES,
  normalizeSupportLocale,
  parseSupportLocale,
  readCachedTranslation,
  supportLocaleLanguage,
  type SupportLocale,
  type TranslationMap,
} from "./supportLocales.ts";

function openAiApiKey(): string {
  return Deno.env.get("OPENAI_API_KEY") ?? "";
}

const MODEL =
  Deno.env.get("SUPPORT_TRANSLATE_MODEL")?.trim() ||
  Deno.env.get("SUPPORT_OPENAI_MODEL")?.trim() ||
  "gpt-4o-mini";

export async function translateTextWithOpenAI(params: {
  text: string;
  sourceLocale: SupportLocale;
  targetLocale: SupportLocale;
}): Promise<string> {
  const { text, sourceLocale, targetLocale } = params;
  if (!text.trim()) return text;
  if (sourceLocale === targetLocale) return text;
  const apiKey = openAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const sourceLang = supportLocaleLanguage(sourceLocale);
  const targetLang = supportLocaleLanguage(targetLocale);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are a translation engine for UniCopier support chat. Translate the user message into the requested language. Preserve markdown (bold, lists, links), numbers, product names (UniCopier, MetaTrader, Telegram, Discord, TradingView), and URLs. Output ONLY the translation — no quotes, notes, or preamble.",
        },
        {
          role: "user",
          content: `Source language: ${sourceLang} (${sourceLocale})\nTarget language: ${targetLang} (${targetLocale})\n\nMessage:\n${text}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI translate failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const out = String(json.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new Error("Empty translation from OpenAI");
  return out;
}

/** Detect a locale without treating an unavailable model as proof of English. */
export async function tryDetectLocaleWithOpenAI(
  text: string,
): Promise<SupportLocale | null> {
  const apiKey = openAiApiKey();
  if (!text.trim() || !apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `Detect the language of the message. Reply with ONLY one locale code from: ${SUPPORT_LOCALES.join(", ")}. If unsure, reply "en".`,
          },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return parseSupportLocale(String(json.choices?.[0]?.message?.content ?? "").trim());
  } catch {
    return null;
  }
}

/** Backward-compatible detector for callers that need an English fallback. */
export async function detectLocaleWithOpenAI(text: string): Promise<SupportLocale> {
  return (await tryDetectLocaleWithOpenAI(text)) ?? "en";
}

type Channel = "chat" | "ticket";

function tableFor(channel: Channel): string {
  return channel === "chat" ? "support_messages" : "support_ticket_messages";
}

/**
 * Detect text that is likely Turkish. Turkish uses Latin letters, so script
 * detection alone cannot find a message that was incorrectly stored as `en`.
 */
export function looksTurkish(text: string): boolean {
  const turkishCharacters = text.match(/[çğıöşü]/gi) ?? [];
  const hasTurkishWord =
    /\b(tamam(?:d(?:ı|i)r)?|şimdi|nasıl|neden|nedir|merhaba|teşekkür|yardım|maalesef|değil|çünkü|benim|için|olarak|sonra|önce|güncelleme|sinyal|hesap|hedef|çalışıyor|gönder|mesaj)\b/iu.test(
      text,
    );
  const hasTurkishSuffix = /(?:lar|ler|dır|dir|dur|mış|mış|acak|ecek|iyor)\b/iu.test(text);

  return (
    hasTurkishWord ||
    turkishCharacters.length >= 2 ||
    (turkishCharacters.length >= 1 && hasTurkishSuffix)
  );
}

/** Cheap check for text that is unlikely to be English. */
export function looksNonEnglish(text: string): boolean {
  return (
    /[\u0400-\u04FF\u0600-\u06FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(text) ||
    looksTurkish(text)
  );
}

/**
 * Decide whether a new message needs an explicit language check. English can
 * use the English default, while any other preferred locale is checked so an
 * English or Turkish message is not mislabeled with the conversation locale.
 */
export function shouldDetectSupportMessageLocale(
  preferredLocale: SupportLocale,
  text: string,
): boolean {
  const hasText = text.trim().length > 0 && text !== "Shared an image";
  return hasText && (preferredLocale !== "en" || looksNonEnglish(text));
}

export async function ensureMessageTranslation(
  admin: SupabaseClient,
  params: {
    channel: Channel;
    messageId: string;
    targetLocale: string;
    /** Re-detect the original language before using or adding a cached translation. */
    repairSourceLocale?: boolean;
  },
): Promise<{
  text: string;
  source_locale: SupportLocale;
  translated: boolean;
  translations: TranslationMap;
  source_repaired: boolean;
  cache_saved: boolean;
}> {
  const targetLocale = normalizeSupportLocale(params.targetLocale);
  const table = tableFor(params.channel);

  const { data: row, error } = await admin
    .from(table)
    .select("id, body, source_locale, translations")
    .eq("id", params.messageId)
    .maybeSingle();

  if (error || !row) {
    throw new Error(error?.message ?? "Message not found");
  }

  const body = String(row.body ?? "");
  const observedSourceLocale = normalizeSupportLocale(row.source_locale as string);
  let sourceLocale = observedSourceLocale;
  let sourceRepaired = false;
  let existing =
    row.translations && typeof row.translations === "object" && !Array.isArray(row.translations)
      ? ({ ...(row.translations as TranslationMap) } as TranslationMap)
      : ({} as TranslationMap);

  // Skip translating image-only placeholders
  if (!body.trim() || body === "Shared an image") {
    return {
      text: body,
      source_locale: sourceLocale,
      translated: false,
      translations: existing,
      source_repaired: sourceRepaired,
      cache_saved: true,
    };
  }

  // Only the explicit, authorized repair action may change a stored source
  // locale. Ordinary customer and guest requests use the stored label as-is.
  if (params.repairSourceLocale === true) {
    const detected = await tryDetectLocaleWithOpenAI(body);
    const correctedLocale =
      detected === "en" && looksTurkish(body) ? "tr" : detected;
    if (!correctedLocale) {
      throw new Error("Language detection unavailable");
    }
    if (correctedLocale !== sourceLocale) {
      sourceLocale = correctedLocale;
      // Detection took a round-trip, so confirm the text is still the one the
      // locale was detected on before writing it.
      const { data: checkRow, error: checkErr } = await admin
        .from(table)
        .select("body")
        .eq("id", params.messageId)
        .maybeSingle();
      if (checkErr) {
        throw new Error(`Could not verify the message: ${checkErr.message}`);
      }
      if (!checkRow || String(checkRow.body ?? "") !== body) {
        throw new Error("Message changed during translation");
      }
      // A correction invalidates every cached translation because those caches
      // may have been produced while the row still claimed the wrong language.
      existing = {};
      const { data: repairedRow, error: srcErr } = await admin
        .from(table)
        .update({ source_locale: sourceLocale, translations: existing })
        .eq("id", params.messageId)
        .eq("source_locale", observedSourceLocale)
        .select("id")
        .maybeSingle();
      if (srcErr) {
        throw new Error(`Could not correct the message language: ${srcErr.message}`);
      }
      if (!repairedRow) {
        throw new Error("Message language changed during repair");
      }
      sourceRepaired = true;
    }
  }

  const cached = readCachedTranslation(existing, targetLocale);
  if (cached) {
    return {
      text: cached,
      source_locale: sourceLocale,
      translated: true,
      translations: existing,
      source_repaired: sourceRepaired,
      cache_saved: true,
    };
  }

  if (sourceLocale === targetLocale) {
    return {
      text: body,
      source_locale: sourceLocale,
      translated: false,
      translations: existing,
      source_repaired: sourceRepaired,
      cache_saved: true,
    };
  }

  const translated = await translateTextWithOpenAI({
    text: body,
    sourceLocale,
    targetLocale,
  });

  // Freshness check after the model call: an edit during the round-trip
  // clears `translations`, and writing this result would pin the old wording
  // under the new text — the cache is keyed by locale alone, so every later
  // request would keep returning it. A concurrent source-locale repair must
  // also discard this translation because it was produced from the old source
  // language. Comparing here (rather than with `.eq("body", ...)`) keeps the
  // body out of the request line: bodies can be 8 000 chars, which a proxy may
  // reject with 414 and silently disable the cache for long messages.
  const { data: freshRow, error: freshErr } = await admin
    .from(table)
    .select("body, source_locale")
    .eq("id", params.messageId)
    .maybeSingle();
  if (freshErr) {
    throw new Error(`Could not verify the message: ${freshErr.message}`);
  }
  if (!freshRow || String(freshRow.body ?? "") !== body) {
    throw new Error("Message changed during translation");
  }
  const freshSourceLocale = normalizeSupportLocale(
    String(freshRow.source_locale ?? "en"),
  );
  if (freshSourceLocale !== sourceLocale) {
    throw new Error("Message language changed during translation");
  }

  const next: TranslationMap = { ...existing, [targetLocale]: translated };
  // Ordinary requests never write `source_locale`. The conditional update
  // also prevents a stale translation from being cached if a repair changes
  // the source language between the freshness check and this write.
  const { data: updatedRow, error: updErr } = await admin
    .from(table)
    .update({ translations: next })
    .eq("id", params.messageId)
    .eq("source_locale", sourceLocale)
    .select("id")
    .maybeSingle();
  if (updErr) {
    if (params.repairSourceLocale === true) {
      throw new Error(`Could not save the translation cache: ${updErr.message}`);
    }
    console.error("translation cache write failed", updErr.message);
    return {
      text: translated,
      source_locale: sourceLocale,
      translated: true,
      translations: next,
      source_repaired: sourceRepaired,
      cache_saved: false,
    };
  }
  if (!updatedRow) {
    throw new Error("Message language changed during translation");
  }

  return {
    text: translated,
    source_locale: sourceLocale,
    translated: true,
    translations: next,
    source_repaired: sourceRepaired,
    cache_saved: !updErr,
  };
}

/** Best-effort; never throws to callers on write paths. */
export async function eagerEnsureTranslation(
  admin: SupabaseClient,
  params: {
    channel: Channel;
    messageId: string | null | undefined;
    targetLocale: string | null | undefined;
  },
): Promise<void> {
  if (!params.messageId) return;
  const target = normalizeSupportLocale(params.targetLocale);
  try {
    await ensureMessageTranslation(admin, {
      channel: params.channel,
      messageId: params.messageId,
      targetLocale: target,
    });
  } catch (err) {
    console.error("eagerEnsureTranslation failed", err);
  }
}
