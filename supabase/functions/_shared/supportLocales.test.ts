import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  SUPPORT_LOCALES,
  normalizeSupportLocale,
  parseSupportLocale,
  resolveMessageText,
  supportLocaleLanguage,
  supportReplyLanguageAddon,
} from "./supportLocales.ts";

Deno.test("support locales include Turkish and parse regional tags", () => {
  assertEquals(SUPPORT_LOCALES.includes("tr"), true);
  assertEquals(normalizeSupportLocale("tr"), "tr");
  assertEquals(normalizeSupportLocale("tr-TR"), "tr");
  assertEquals(normalizeSupportLocale("TR_tr"), "tr");
  assertEquals(parseSupportLocale("turkish"), "tr");
  assertEquals(parseSupportLocale("de-DE"), null);
});

Deno.test("Turkish is named as the support reply language", () => {
  assertEquals(supportLocaleLanguage("tr"), "Turkish");
  assertStringIncludes(supportReplyLanguageAddon("tr"), "**Turkish**");
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
