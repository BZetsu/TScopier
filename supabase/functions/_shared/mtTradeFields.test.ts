import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  resolveMtCloseTimestamp,
  resolveMtOpenTimestamp,
} from "./mtTradeFields.ts"

Deno.test("resolveMtCloseTimestamp: MT5 deal time unix seconds", () => {
  const iso = resolveMtCloseTimestamp({ ticket: 1, time: 1_718_380_800 }, "trades")
  assertEquals(iso, new Date(1_718_380_800_000).toISOString())
})

Deno.test("resolveMtCloseTimestamp: closeTime string", () => {
  const iso = resolveMtCloseTimestamp(
    { ticket: 1, closeTime: "2026-06-14T14:13:01" },
    "trades",
  )
  assertEquals(iso, new Date("2026-06-14T14:13:01").toISOString())
})

Deno.test("resolveMtOpenTimestamp: nested dealInternalIn open time", () => {
  const iso = resolveMtOpenTimestamp({
    ticket: 2,
    time: 1_718_390_000,
    dealInternalIn: { openTime: "2026-06-14T12:00:00" },
  }, "trades")
  assertEquals(iso, new Date("2026-06-14T12:00:00").toISOString())
})

Deno.test("resolveMtOpenTimestamp: does not use top-level time on trades profile", () => {
  const iso = resolveMtOpenTimestamp({ ticket: 3, time: 1_718_380_800 }, "trades")
  assertEquals(iso, null)
})
