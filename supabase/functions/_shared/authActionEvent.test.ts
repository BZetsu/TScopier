import { assertEquals } from "jsr:@std/assert"
import {
  buildAuthActionDetail,
  classifyAuthActionOutcome,
  redactWorkerUrls,
} from "./authActionEvent.ts"

Deno.test("buildAuthActionDetail records a successful action", () => {
  assertEquals(
    buildAuthActionDetail({
      action: "reconnect_telegram",
      clientId: "tab-1",
      ip: "41.90.173.1",
      ua: "iPhone",
      outcome: { ok: true, status: 200, reason: null, error: null },
    }),
    {
      action: "reconnect_telegram",
      client: "tab-1",
      ip: "41.90.173.1",
      ua: "iPhone",
      ok: true,
      status: 200,
    },
  )
})

Deno.test("buildAuthActionDetail keeps a rejected action distinguishable from success", () => {
  assertEquals(
    buildAuthActionDetail({
      action: "reconnect_telegram",
      clientId: "-",
      ip: "41.90.173.1",
      ua: "iPhone",
      outcome: { ok: false, status: 200, reason: "wrong_shard", error: "wrong_shard" },
    }),
    {
      action: "reconnect_telegram",
      client: "-",
      ip: "41.90.173.1",
      ua: "iPhone",
      ok: false,
      status: 200,
      reason: "wrong_shard",
      error: "wrong_shard",
    },
  )
})

Deno.test("buildAuthActionDetail omits empty reason, error and status", () => {
  assertEquals(
    buildAuthActionDetail({
      action: "send_code",
      clientId: "",
      ip: null,
      ua: null,
      outcome: { ok: false, reason: "  ", error: "" },
    }),
    {
      action: "send_code",
      client: "-",
      ip: null,
      ua: null,
      ok: false,
    },
  )
})

Deno.test("buildAuthActionDetail trims reason and error", () => {
  const detail = buildAuthActionDetail({
    action: "verify_code",
    outcome: { ok: false, reason: " wrong_shard ", error: " nope " },
  })
  assertEquals(detail.reason, "wrong_shard")
  assertEquals(detail.error, "nope")
})

Deno.test("buildAuthActionDetail never reports ok for a missing outcome value", () => {
  const detail = buildAuthActionDetail({
    action: "disconnect_telegram",
    outcome: { ok: false },
  })
  assertEquals(detail.ok, false)
  assertEquals("status" in detail, false)
})

Deno.test("buildAuthActionDetail ignores a non-numeric status", () => {
  const detail = buildAuthActionDetail({
    action: "send_code",
    outcome: { ok: true, status: Number.NaN },
  })
  assertEquals("status" in detail, false)
})

Deno.test("classifyAuthActionOutcome flags a 200 wrong_shard as a failure", () => {
  assertEquals(
    classifyAuthActionOutcome(200, true, {
      ok: false,
      reason: "wrong_shard",
      error: "wrong_shard",
    }),
    { ok: false, status: 200, reason: "wrong_shard", error: "wrong_shard" },
  )
})

Deno.test("classifyAuthActionOutcome accepts a normal success payload", () => {
  assertEquals(
    classifyAuthActionOutcome(200, true, { ok: true, session_id: "abc" }),
    { ok: true, status: 200, reason: null, error: null },
  )
})

Deno.test("classifyAuthActionOutcome treats a payload without ok as success only on 2xx", () => {
  assertEquals(classifyAuthActionOutcome(200, true, { channels: [] }).ok, true)
  assertEquals(classifyAuthActionOutcome(500, false, { channels: [] }).ok, false)
})

Deno.test("classifyAuthActionOutcome records a worker error body", () => {
  assertEquals(
    classifyAuthActionOutcome(401, false, { error: "telegram_session_invalid" }),
    { ok: false, status: 401, reason: null, error: "telegram_session_invalid" },
  )
})

Deno.test("classifyAuthActionOutcome survives a non-JSON body", () => {
  assertEquals(classifyAuthActionOutcome(502, false, "<html>bad gateway</html>"), {
    ok: false,
    status: 502,
    reason: null,
    error: null,
  })
})

Deno.test("classifyAuthActionOutcome marks a 2FA password challenge", () => {
  const outcome = classifyAuthActionOutcome(200, true, { requires_password: true })
  assertEquals(outcome.ok, true)
  assertEquals(outcome.reason, "requires_password")
})

Deno.test("redactWorkerUrls hides listener hostnames", () => {
  const raw =
    "error sending request for url (https://listener-shard-3-production.up.railway.app/auth/reconnect_telegram): dns error"
  const safe = redactWorkerUrls(raw)
  assertEquals(safe.includes("railway.app"), false)
  assertEquals(safe.includes("<worker>"), true)
})

Deno.test("redactWorkerUrls caps the stored text", () => {
  assertEquals(redactWorkerUrls("x".repeat(500)).length, 200)
})
