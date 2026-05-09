import { assertEquals } from "jsr:@std/assert@1"
import {
  extractSlFromText,
  extractTpLevelsFromText,
  parseDeterministicManagement,
  parseSimpleSignal,
} from "./management_fastpath.ts"

Deno.test("extractTpLevelsFromText handles TP @ style", () => {
  assertEquals(extractTpLevelsFromText("Set TP @ 80938"), [80938])
  assertEquals(extractTpLevelsFromText("TP1: 4722.5 🤑TP2: 4720"), [4722.5, 4720])
})

Deno.test("extractSlFromText handles adjust / @", () => {
  assertEquals(extractSlFromText("Adjust SL to 70500"), 70500)
  assertEquals(extractSlFromText("SL @ 70000"), 70000)
})

Deno.test("modify: Set TP @ number", () => {
  const p = parseDeterministicManagement("Set TP @ 80938")
  assertEquals(p?.action, "modify")
  assertEquals(p?.tp, [80938])
})

Deno.test("modify: Adjust SL to number", () => {
  const p = parseDeterministicManagement("Adjust SL to 70500")
  assertEquals(p?.action, "modify")
  assertEquals(p?.sl, 70500)
})

Deno.test("close: Close all now", () => {
  const p = parseDeterministicManagement("CLOSE ALL NOW")
  assertEquals(p?.action, "close")
})

Deno.test("close: Close BTCUSD trade now", () => {
  const p = parseDeterministicManagement("Close BTCUSD trade now")
  assertEquals(p?.action, "close")
  assertEquals(p?.symbol, "BTCUSD")
})

Deno.test("entry: Buy now with symbol", () => {
  const p = parseSimpleSignal("BUY BTCUSD NOW")
  assertEquals(p?.action, "buy")
  assertEquals(p?.symbol, "BTCUSD")
})

Deno.test("entry: BUY BTCUSD + SL/TP must be buy not modify", () => {
  const msg =
    `SIGNAL ALERT\n\nBUY BTCUSD 96500\n\n🔴SL: 96480\n🤑TP1: 96520`
  const p = parseDeterministicManagement(msg)
  assertEquals(p?.action, "buy")
  assertEquals(p?.symbol, "BTCUSD")
  assertEquals(p?.sl, 96480)
  assertEquals(p?.tp.includes(96520), true)
})
