import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isWrongShardPayload,
  listenerWorkerUrlCandidates,
  shardForUserId,
} from "./workerShard.ts"

Deno.test("shardForUserId is stable for known user", () => {
  const userId = "a23f24d9-1538-4dc1-956a-846b8e85d4e6"
  assertEquals(shardForUserId(userId, 6), 0)
  assertEquals(shardForUserId(userId, 5), 4)
})

Deno.test("listenerWorkerUrlCandidates puts primary first then unique others", () => {
  const env = {
    get(name: string) {
      if (name === "LISTENER_SHARD_URLS") {
        return "https://a.example,https://b.example,https://c.example"
      }
      return undefined
    },
  }
  const userId = "00000000-0000-0000-0000-000000000001"
  const primaryIdx = shardForUserId(userId, 3)
  const urls = listenerWorkerUrlCandidates(userId, env)
  assertEquals(urls.length, 3)
  assertEquals(urls[0], ["https://a.example", "https://b.example", "https://c.example"][primaryIdx])
})

Deno.test("isWrongShardPayload detects reason and error", () => {
  assertEquals(isWrongShardPayload({ ok: false, reason: "wrong_shard" }), true)
  assertEquals(isWrongShardPayload({ error: "wrong_shard" }), true)
  assertEquals(isWrongShardPayload({ error: "other" }), false)
  assertEquals(isWrongShardPayload(null), false)
})
