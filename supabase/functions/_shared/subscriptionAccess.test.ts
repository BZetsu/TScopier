import { assertEquals } from "jsr:@std/assert@1";
import { extensionWindowActive, hasLiveSubscriptionExtension } from "./subscriptionAccess.ts";

Deno.test("extensionWindowActive: a grant is open from granted_at until days pass", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  assertEquals(extensionWindowActive(7, "2026-11-10T00:00:00.000Z", now), true);
  assertEquals(extensionWindowActive(3, "2026-11-10T00:00:00.000Z", now), false);
  // Exactly at the end moment the window counts as closed.
  const end = Date.parse("2026-11-10T00:00:00.000Z") + 5 * 86_400_000;
  assertEquals(extensionWindowActive(5, "2026-11-10T00:00:00.000Z", end), false);
});

Deno.test("extensionWindowActive: rejects unusable rows", () => {
  const now = Date.now();
  assertEquals(extensionWindowActive(0, "2026-11-10T00:00:00.000Z", now), false);
  assertEquals(extensionWindowActive(7, "not-a-date", now), false);
  assertEquals(extensionWindowActive(null, "2026-11-10T00:00:00.000Z", now), false);
});

Deno.test("hasLiveSubscriptionExtension: any open grant counts, expired ones do not", async () => {
  const now = Date.now();
  const makeClient = (rows: Array<{ days: number; granted_at: string }>) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    // deno-lint-ignore no-explicit-any
    return { from: () => chain } as any;
  };

  const active = await hasLiveSubscriptionExtension(
    makeClient([{ days: 14, granted_at: new Date(now - 86_400_000).toISOString() }]),
    "user-1",
  );
  assertEquals(active, true);

  const expired = await hasLiveSubscriptionExtension(
    makeClient([{ days: 3, granted_at: new Date(now - 5 * 86_400_000).toISOString() }]),
    "user-1",
  );
  assertEquals(expired, false);

  const none = await hasLiveSubscriptionExtension(makeClient([]), "user-1");
  assertEquals(none, false);
});

Deno.test("extensionWindowActive: a grant awaits the end of a running paid period", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  const grantedAt = "2026-11-10T00:00:00.000Z";
  const running = { status: "active", current_period_end: "2026-12-10T00:00:00.000Z" };
  // Queued behind the paid period: not active today.
  assertEquals(extensionWindowActive(7, grantedAt, now, running), false);
  // Active inside the window that starts at the period end.
  const during = Date.parse("2026-12-12T00:00:00.000Z");
  assertEquals(extensionWindowActive(7, grantedAt, during, running), true);
});

Deno.test("extensionWindowActive: a canceled row keeps its period end as the anchor", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  // Granted 7 days before the period ended yesterday; 7-day grant runs 6 more days.
  const canceled = { status: "canceled", current_period_end: "2026-11-14T00:00:00.000Z" };
  assertEquals(extensionWindowActive(7, "2026-11-07T00:00:00.000Z", now, canceled), true);
  assertEquals(extensionWindowActive(7, "2026-11-07T00:00:00.000Z", now, null), false);
});
