import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  SUPPORT_LOCALES,
  normalizeSupportLocale,
  parseSupportLocale,
  resolveMessageText,
  supportLocaleLanguage,
  supportReplyLanguageAddon,
} from "./supportLocales.ts";

Deno.test("support locales include German and Turkish and parse regional tags", () => {
  assertEquals(SUPPORT_LOCALES.includes("de"), true);
  assertEquals(normalizeSupportLocale("de"), "de");
  assertEquals(normalizeSupportLocale("de-DE"), "de");
  assertEquals(normalizeSupportLocale("DE_de"), "de");
  assertEquals(SUPPORT_LOCALES.includes("tr"), true);
  assertEquals(normalizeSupportLocale("tr"), "tr");
  assertEquals(normalizeSupportLocale("tr-TR"), "tr");
  assertEquals(normalizeSupportLocale("TR_tr"), "tr");
  assertEquals(parseSupportLocale("turkish"), "tr");
  assertEquals(parseSupportLocale("it-IT"), null);
});

Deno.test("German and Turkish are named as support reply languages", () => {
  assertEquals(supportLocaleLanguage("de"), "German");
  assertStringIncludes(supportReplyLanguageAddon("de"), "**German**");
  assertEquals(supportLocaleLanguage("tr"), "Turkish");
  assertStringIncludes(supportReplyLanguageAddon("tr"), "**Turkish**");
});

Deno.test("message resolution uses a cached German translation", () => {
  const resolved = resolveMessageText({
    body: "Guten Tag, wie kann ich Ihnen helfen?",
    sourceLocale: "de",
    translations: { en: "Hello, how can I help?" },
    viewerLocale: "en",
  });

  assertEquals(resolved.sourceLocale, "de");
  assertEquals(resolved.isTranslated, true);
  assertEquals(resolved.text, "Hello, how can I help?");
});

Deno.test("message resolution uses a cached Turkish translation", () => {
  const resolved = resolveMessageText({
    body: "Merhaba, nasıl yardımcı olabilirim?",
    sourceLocale: "tr",
    translations: { en: "Hello, how can I help?" },
    viewerLocale: "en",
  });

  assertEquals(resolved.sourceLocale, "tr");
  assertEquals(resolved.isTranslated, true);
  assertEquals(resolved.text, "Hello, how can I help?");
});
