/**
 * Worker process role and shard configuration (Railway / multi-service deploy).
 *
 * WORKER_ROLE:
 *   all      — monolith (default): listener + trade monitors + backtest HTTP
 *   listener — Telegram ingest only; no trade monitors; backtest HTTP returns 503
 *   trade    — TradeExecutor + monitors; no Telegram listeners
 *   backtest — Ephemeral Telegram client for backtest sync only; no live listener
 */

export type WorkerRole = 'all' | 'listener' | 'trade' | 'backtest'

function parseRole(raw: string | undefined): WorkerRole {
  const v = String(raw ?? 'all').toLowerCase().trim()
  if (v === 'listener' || v === 'trade' || v === 'backtest') return v
  return 'all'
}

const role = parseRole(process.env.WORKER_ROLE)

export const workerConfig = {
  role,
  instanceId: String(
    process.env.WORKER_INSTANCE_ID
    ?? `${process.env.HOSTNAME ?? 'local'}:${process.pid}`,
  ),
  shardId: Math.max(0, Math.floor(Number(process.env.WORKER_SHARD_ID ?? 0))),
  shardCount: Math.max(1, Math.floor(Number(process.env.WORKER_SHARD_COUNT ?? 1))),
  runsListener: role === 'all' || role === 'listener',
  runsTrade: role === 'all' || role === 'trade',
  runsBacktestHttp: role === 'all' || role === 'backtest',
  /** Backtest uses a short-lived Telegram client, never the live listener connection. */
  backtestUsesEphemeralClient: role !== 'all' || process.env.BACKTEST_EPHEMERAL_CLIENT !== 'false',
}

export function shardForUserId(userId: string, shardCount: number): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(h) % Math.max(1, shardCount)
}

export function userBelongsToShard(userId: string): boolean {
  if (workerConfig.shardCount <= 1) return true
  return shardForUserId(userId, workerConfig.shardCount) === workerConfig.shardId
}

export function listenerWorkerId(): string {
  return `listener:${workerConfig.shardId}:${workerConfig.instanceId}`
}

export function leaseRoleLabel(): string {
  if (workerConfig.role === 'listener') return 'listener'
  if (workerConfig.role === 'all') return 'listener'
  return workerConfig.role
}
