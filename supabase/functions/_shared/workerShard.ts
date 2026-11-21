/**
 * Stable per-user shard helpers for Edge functions.
 * Hash must match worker `shardForUserId` in worker/src/workerConfig.ts.
 */

/** Java-style string hash → shard index in [0, shardCount). */
export function shardForUserId(userId: string, shardCount: number): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(h) % Math.max(1, shardCount)
}

/** Accept host-only Railway URLs — fetch requires a scheme. */
export function normalizeWorkerBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export function parseShardUrls(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((s) => normalizeWorkerBaseUrl(s))
    .filter(Boolean)
}

export type EnvLike = { get(name: string): string | undefined }

/** Ordered listener fleet from LISTENER_SHARD_URLS (empty → single-URL fallback). */
export function listenerShardUrls(env: EnvLike = Deno.env): string[] {
  return parseShardUrls(env.get("LISTENER_SHARD_URLS"))
}

/**
 * Pick the listener base URL that owns this user.
 * Prefer LISTENER_SHARD_URLS[hash % N]; else TELEGRAM_LISTENER_URL / WORKER_URL.
 */
export function pickListenerWorkerUrl(userId: string, env: EnvLike = Deno.env): string {
  const shards = listenerShardUrls(env)
  if (shards.length > 0) {
    return shards[shardForUserId(userId, shards.length)] ?? ""
  }
  return normalizeWorkerBaseUrl(
    env.get("TELEGRAM_LISTENER_URL") ?? env.get("WORKER_URL") ?? "",
  )
}

/**
 * Primary listener first, then remaining LISTENER_SHARD_URLS.
 * Used when Edge N disagrees with worker WORKER_SHARD_COUNT (wrong_shard) so
 * auth can find the process that actually owns the user.
 */
export function listenerWorkerUrlCandidates(userId: string, env: EnvLike = Deno.env): string[] {
  const primary = pickListenerWorkerUrl(userId, env)
  const shards = listenerShardUrls(env)
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of [primary, ...shards]) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

export function isWrongShardPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const rec = payload as Record<string, unknown>
  return rec.reason === "wrong_shard" || rec.error === "wrong_shard"
}

/** True when any listener URL is configured (fleet or single). */
export function hasListenerWorkerUrl(env: EnvLike = Deno.env): boolean {
  if (listenerShardUrls(env).length > 0) return true
  return Boolean(
    normalizeWorkerBaseUrl(env.get("TELEGRAM_LISTENER_URL") ?? env.get("WORKER_URL") ?? ""),
  )
}

/**
 * Pick trade entry (or mgmt) URL for a user — mirrors worker tradeSignalPush routing.
 */
export function pickTradeWorkerUrl(
  userId: string,
  opts: { management?: boolean } = {},
  env: EnvLike = Deno.env,
): string {
  const mgmt = opts.management === true
  const mgmtShards = parseShardUrls(env.get("TRADE_MGMT_WORKER_SHARD_URLS"))
  if (mgmt && mgmtShards.length > 1) {
    return mgmtShards[shardForUserId(userId, mgmtShards.length)] ?? ""
  }
  if (mgmt && mgmtShards.length === 1) return mgmtShards[0]!

  const mgmtUrl = normalizeWorkerBaseUrl(env.get("TRADE_MGMT_WORKER_URL") ?? "")
  if (mgmt && mgmtUrl) return mgmtUrl

  const entryShards = parseShardUrls(env.get("TRADE_WORKER_SHARD_URLS"))
  if (entryShards.length > 1) {
    return entryShards[shardForUserId(userId, entryShards.length)] ?? ""
  }
  if (entryShards.length === 1) return entryShards[0]!

  return normalizeWorkerBaseUrl(
    env.get("TRADE_WORKER_URL")
      ?? env.get("WORKER_URL")
      ?? env.get("WORKER_PUBLIC_URL")
      ?? "",
  )
}
