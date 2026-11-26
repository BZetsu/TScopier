import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ensureMessageTranslation,
  looksNonEnglish,
  looksTurkish,
  shouldDetectSupportMessageLocale,
} from "./supportTranslate.ts";

type MessageRow = {
  id: string;
  body: string;
  source_locale: string;
  translations: Record<string, string>;
};

type FakeAdminOptions = {
  beforeUpdate?: (row: MessageRow) => void;
};

function fakeAdmin(row: MessageRow, options: FakeAdminOptions = {}) {
  const updates: Array<Partial<MessageRow>> = [];

  const client = {
    from() {
      let operation: "select" | "update" = "select";
      let patch: Partial<MessageRow> = {};
      let filters: Array<[string, unknown]> = [];

      const matchesFilters = () =>
        filters.every(
          ([column, value]) =>
            row[column as keyof MessageRow] === value,
        );

      const applyUpdate = () => {
        options.beforeUpdate?.(row);
        if (!matchesFilters()) return null;
        updates.push({ ...patch });
        Object.assign(row, patch);
        return { id: row.id };
      };

      const builder = {
        select() {
          return builder;
        },
        update(value: Partial<MessageRow>) {
          operation = "update";
          patch = value;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          if (operation === "update") {
            return Promise.resolve({ data: applyUpdate(), error: null });
          }
          return Promise.resolve({ data: { ...row }, error: null });
        },
        then<TResult1 = { data: { id: string } | null; error: null }, TResult2 = never>(
          onfulfilled?:
            | ((
                value: { data: { id: string } | null; error: null },
              ) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          if (operation === "update") {
            return Promise.resolve({ data: applyUpdate(), error: null }).then(
              onfulfilled,
              onrejected,
            );
          }
          return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
  };

  return { admin: client as never, row, updates };
}

Deno.test("Turkish detection recognizes Turkish text without misclassifying common English", () => {
  assertEquals(
    looksTurkish(
      "Tamamdır şimdi en baştan soruyorum Gold buy now geldi ve ikinci sinyal güncelleme mesajı geldi",
    ),
    true,
  );
  assertEquals(looksTurkish("tamamdir"), true);
  assertEquals(looksTurkish("Gold buy now, then close the higher entry"), false);
  assertEquals(looksTurkish("The channel sent a new gold signal"), false);
  assertEquals(looksTurkish("Merhaba"), true);
  assertEquals(looksNonEnglish("Merhaba"), true);
});

Deno.test("new-message detection checks non-English preferred locales", () => {
  assertEquals(
    shouldDetectSupportMessageLocale("tr", "The signal update did not arrive"),
    true,
  );
  assertEquals(shouldDetectSupportMessageLocale("tr", "Sinyal güncellemesi gelmedi"), true);
  assertEquals(shouldDetectSupportMessageLocale("en", "Sinyal güncellemesi gelmedi"), true);
  assertEquals(shouldDetectSupportMessageLocale("en", "The signal update did not arrive"), false);
  assertEquals(shouldDetectSupportMessageLocale("tr", "Shared an image"), false);
});

Deno.test("an explicit repair corrects the Turkish source locale and caches English", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");
  let modelCalls = 0;

  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = async (_input, init) => {
    const request = String(init?.body ?? "");
    if (request.includes("Detect the language of the message")) {
      modelCalls += 1;
      return Response.json({
        choices: [{ message: { content: "tr" } }],
      });
    }
    if (request.includes("Source language: Turkish")) {
      modelCalls += 1;
      return Response.json({
        choices: [{ message: { content: "Okay, I understand the second signal update." } }],
      });
    }
    throw new Error("Unexpected OpenAI request");
  };

  try {
    const { admin, row, updates } = fakeAdmin({
      id: "message-1",
      body: "Tamamdır şimdi Gold buy now geldi ve ikinci sinyal güncelleme mesajı geldi",
      source_locale: "en",
      translations: {},
    });

    const first = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-1",
      targetLocale: "en",
      repairSourceLocale: true,
    });

    assertEquals(first.source_locale, "tr");
    assertEquals(first.source_repaired, true);
    assertEquals(first.translated, true);
    assertEquals(first.cache_saved, true);
    assertEquals(first.text, "Okay, I understand the second signal update.");
    assertEquals(row.source_locale, "tr");
    assertEquals(row.translations.en, "Okay, I understand the second signal update.");
    assertEquals(updates.length, 2);

    const second = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-1",
      targetLocale: "en",
    });

    assertEquals(second.source_locale, "tr");
    assertEquals(second.translated, true);
    assertEquals(second.text, "Okay, I understand the second signal update.");
    assertEquals(modelCalls, 2, "a cached translation must not call the model again");
    assertEquals(updates.length, 2, "a cached translation must not write again");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});

Deno.test("a clear Turkish word overrides an English model result", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = async (_input, init) => {
    const request = String(init?.body ?? "");
    if (request.includes("Detect the language of the message")) {
      return Response.json({ choices: [{ message: { content: "en" } }] });
    }
    if (request.includes("Source language: Turkish")) {
      return Response.json({ choices: [{ message: { content: "Hello" } }] });
    }
    throw new Error("Unexpected OpenAI request");
  };

  try {
    const { admin, row } = fakeAdmin({
      id: "message-3",
      body: "Merhaba",
      source_locale: "en",
      translations: {},
    });

    const corrected = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-3",
      targetLocale: "en",
      repairSourceLocale: true,
    });

    assertEquals(corrected.source_locale, "tr");
    assertEquals(corrected.text, "Hello");
    assertEquals(row.source_locale, "tr");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});

Deno.test("an ordinary ensure request cannot change the stored source locale", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("The model must not be called for an ordinary same-locale request");
  };

  try {
    const { admin, row, updates } = fakeAdmin({
      id: "message-ordinary",
      body: "Merhaba",
      source_locale: "en",
      translations: {},
    });

    const result = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-ordinary",
      targetLocale: "en",
    });

    assertEquals(result.source_locale, "en");
    assertEquals(result.source_repaired, false);
    assertEquals(result.translated, false);
    assertEquals(result.text, "Merhaba");
    assertEquals(row.source_locale, "en");
    assertEquals(updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("an ordinary translation updates only the cached translation", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = async (_input, init) => {
    const request = String(init?.body ?? "");
    if (request.includes("Source language: Turkish")) {
      return Response.json({
        choices: [{ message: { content: "Hello" } }],
      });
    }
    throw new Error("Unexpected OpenAI request");
  };

  try {
    const { admin, row, updates } = fakeAdmin({
      id: "message-cache-only",
      body: "Merhaba",
      source_locale: "tr",
      translations: {},
    });

    const result = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-cache-only",
      targetLocale: "en",
    });

    assertEquals(result.source_locale, "tr");
    assertEquals(result.cache_saved, true);
    assertEquals(result.translations.en, "Hello");
    assertEquals(updates.length, 1);
    assertEquals(updates[0]?.source_locale, undefined);
    assertEquals(row.source_locale, "tr");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});

Deno.test("an ordinary translation cannot overwrite a concurrent source locale repair", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = async (_input, init) => {
    const request = String(init?.body ?? "");
    if (request.includes("Source language: Turkish")) {
      return Response.json({
        choices: [{ message: { content: "Stale translation" } }],
      });
    }
    throw new Error("Unexpected OpenAI request");
  };

  try {
    const { admin, row, updates } = fakeAdmin(
      {
        id: "message-race",
        body: "Merhaba",
        source_locale: "tr",
        translations: {},
      },
      {
        beforeUpdate: (currentRow) => {
          currentRow.source_locale = "en";
        },
      },
    );

    await assertRejects(
      () =>
        ensureMessageTranslation(admin, {
          channel: "chat",
          messageId: "message-race",
          targetLocale: "en",
        }),
      Error,
      "Message language changed during translation",
    );

    assertEquals(row.source_locale, "en");
    assertEquals(row.translations.en, undefined);
    assertEquals(updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});

Deno.test("an explicit repair fails when detection is unavailable even for Turkish text", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
  else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  globalThis.fetch = async () => {
    throw new Error("Provider unavailable");
  };

  try {
    const { admin, row, updates } = fakeAdmin({
      id: "message-no-detection",
      body: "Merhaba",
      source_locale: "en",
      translations: {},
    });

    await assertRejects(
      () =>
        ensureMessageTranslation(admin, {
          channel: "chat",
          messageId: "message-no-detection",
          targetLocale: "en",
          repairSourceLocale: true,
        }),
      Error,
      "Language detection unavailable",
    );
    assertEquals(row.source_locale, "en");
    assertEquals(updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});

Deno.test("an explicit repair clears a stale translation after correcting the source locale", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = async (_input, init) => {
    const request = String(init?.body ?? "");
    if (request.includes("Detect the language of the message")) {
      return Response.json({ choices: [{ message: { content: "tr" } }] });
    }
    if (request.includes("Source language: Turkish")) {
      return Response.json({ choices: [{ message: { content: "Fresh English translation" } }] });
    }
    throw new Error("Unexpected OpenAI request");
  };

  try {
    const { admin, row } = fakeAdmin({
      id: "message-2",
      body: "Şimdi ikinci sinyal güncellemesi geldi",
      source_locale: "en",
      translations: { en: "Stale English translation" },
    });

    const repaired = await ensureMessageTranslation(admin, {
      channel: "chat",
      messageId: "message-2",
      targetLocale: "en",
      repairSourceLocale: true,
    });

    assertEquals(repaired.source_locale, "tr");
    assertEquals(repaired.text, "Fresh English translation");
    assertEquals(row.source_locale, "tr");
    assertEquals(row.translations.en, "Fresh English translation");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalApiKey);
  }
});
