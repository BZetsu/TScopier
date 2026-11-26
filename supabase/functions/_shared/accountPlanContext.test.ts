import { assertEquals } from "jsr:@std/assert@1";
import { buildAccountPlanContext } from "./accountPlanContext.ts";

Deno.test("Basic plan resolves to the verified account and channel limits", () => {
  const context = buildAccountPlanContext({
    plan: "basic",
    status: "active",
  });

  assertEquals(context.effective_plan, "basic");
  assertEquals(context.access, "active");
  assertEquals(context.limits, {
    source: "basic",
    max_broker_accounts: 1,
    max_telegram_channels: 5,
    max_backtests_per_month: 5,
    max_tp_rows: 3,
  });
});

Deno.test("Advanced plan includes paid extra broker accounts", () => {
  const context = buildAccountPlanContext({
    plan: "advanced",
    status: "active",
    extraAccounts: 2,
  });

  assertEquals(context.effective_plan, "advanced");
  assertEquals(context.limits?.max_broker_accounts, 7);
  assertEquals(context.limits?.max_telegram_channels, null);
  assertEquals(context.limits?.max_backtests_per_month, null);
  assertEquals(context.limits?.max_tp_rows, null);
});

Deno.test("a live access extension grants Advanced when the subscription is inactive", () => {
  const context = buildAccountPlanContext({
    plan: "basic",
    status: "canceled",
    hasLiveExtension: true,
  });

  assertEquals(context.effective_plan, "advanced");
  assertEquals(context.access, "extension");
  assertEquals(context.limits?.source, "advanced");
  assertEquals(context.limits?.max_broker_accounts, 5);
  assertEquals(context.limits?.max_telegram_channels, null);
});

Deno.test("admin access bypasses plan limits", () => {
  const context = buildAccountPlanContext({
    plan: "basic",
    status: "canceled",
    isAdmin: true,
  });

  assertEquals(context.effective_plan, "advanced");
  assertEquals(context.access, "admin");
  assertEquals(context.limits, {
    source: "admin",
    max_broker_accounts: null,
    max_telegram_channels: null,
    max_backtests_per_month: null,
    max_tp_rows: null,
  });
});

Deno.test("an inactive account without an extension has no active limits", () => {
  const context = buildAccountPlanContext({
    plan: "basic",
    status: "canceled",
  });

  assertEquals(context.effective_plan, null);
  assertEquals(context.access, "inactive");
  assertEquals(context.limits, null);
});

Deno.test("an unknown plan cannot activate Basic limits by accident", () => {
  const context = buildAccountPlanContext({
    plan: "enterprise",
    status: "active",
  });

  assertEquals(context.subscription_plan, null);
  assertEquals(context.effective_plan, null);
  assertEquals(context.limits, null);
});
