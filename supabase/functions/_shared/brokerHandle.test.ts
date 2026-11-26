import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { createBrokerHandle, isBrokerHandle } from "./brokerHandle.ts";

Deno.test("broker handles are stable, opaque, and scoped to the user", async () => {
  const first = await createBrokerHandle("customer-1", "broker-1");
  const second = await createBrokerHandle("customer-1", "broker-1");
  const otherUser = await createBrokerHandle("customer-2", "broker-1");
  const otherBroker = await createBrokerHandle("customer-1", "broker-2");

  assertEquals(first, second);
  assertNotEquals(first, otherUser);
  assertNotEquals(first, otherBroker);
  assert(isBrokerHandle(first));
  assertEquals(first.includes("broker-1"), false);
  assertEquals(first.includes("customer-1"), false);
});

Deno.test("broker handle validation rejects identifiers and malformed values", () => {
  assertEquals(isBrokerHandle("broker-1"), false);
  assertEquals(isBrokerHandle(""), false);
  assertEquals(isBrokerHandle(null), false);
});
