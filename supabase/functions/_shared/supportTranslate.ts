import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeSupportLocale,
  readCachedTranslation,
  supportLocaleLanguage,
  type SupportLocale,
  type TranslationMap,
} from "./supportLocales.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
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
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const sourceLang = supportLocaleLanguage(sourceLocale);
  const targetLang = supportLocaleLanguage(targetLocale);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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

export async function detectLocaleWithOpenAI(text: string): Promise<SupportLocale> {
  if (!text.trim() || !OPENAI_API_KEY) return "en";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'Detect the language of the message. Reply with ONLY one locale code from: en, es, fr, pl, ru, sv, nl, ja, ar. If unsure, reply "en".',
          },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
    });
    if (!res.ok) return "en";
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return normalizeSupportLocale(String(json.choices?.[0]?.message?.content ?? "en").trim());
  } catch {
    return "en";
  }
}

type Channel = "chat" | "ticket";

function tableFor(channel: Channel): string {
  return channel === "chat" ? "support_messages" : "support_ticket_messages";
}

export async function ensureMessageTranslation(
  admin: SupabaseClient,
  params: {
    channel: Channel;
    messageId: string;
    targetLocale: string;
  },
): Promise<{
  text: string;
  source_locale: SupportLocale;
  translated: boolean;
  translations: TranslationMap;
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
  const sourceLocale = normalizeSupportLocale(row.source_locale as string);
  const existing =
    row.translations && typeof row.translations === "object" && !Array.isArray(row.translations)
      ? ({ ...(row.translations as TranslationMap) } as TranslationMap)
      : ({} as TranslationMap);

  if (sourceLocale === targetLocale) {
    return {
      text: body,
      source_locale: sourceLocale,
      translated: false,
      translations: existing,
    };
  }

  const cached = readCachedTranslation(existing, targetLocale);
  if (cached) {
    return {
      text: cached,
      source_locale: sourceLocale,
      translated: true,
      translations: existing,
    };
  }

  // Skip translating image-only placeholders
  if (!body.trim() || body === "Shared an image") {
    return {
      text: body,
      source_locale: sourceLocale,
      translated: false,
      translations: existing,
    };
  }

  const translated = await translateTextWithOpenAI({
    text: body,
    sourceLocale,
    targetLocale,
  });

  const next: TranslationMap = { ...existing, [targetLocale]: translated };
  const { error: updErr } = await admin
    .from(table)
    .update({ translations: next })
    .eq("id", params.messageId);
  if (updErr) {
    console.error("translation cache write failed", updErr.message);
  }

  return {
    text: translated,
    source_locale: sourceLocale,
    translated: true,
    translations: next,
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
