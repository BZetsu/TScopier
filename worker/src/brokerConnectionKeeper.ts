import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyBrokerConnectError,
  type BrokerConnectErrorKind,
} from './brokerConnectError'
import { writeBrokerConnectionStatus } from './brokerConnectionStatus'
import { hardReconnectBrokerSession } from './brokerHardReconnect'
import {
  getMetatraderApi,
  hasMetatraderApiConfigured,
  mtPlatformFrom,
} from './metatraderapi'
import { pauseIfSameMtServer } from './mtServerSessionLock'
import { applyShardToQuery } from './monitorIdleGate'

function isMtUuid(s: string | null | undefined): boolean {
  if (!s) return false
  const v = s.trim()
  if (!v || v.includes('|')) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function hasStoredCredentials(row: BrokerKeeperRow): boolean {
  return Boolean(
    row.auto_reconnect_enabled
    && row.mt_password_encrypted
    && row.account_login?.trim()
    && row.broker_server?.trim(),
  )
}

interface BrokerKeeperRow {
  id: string
  platform: string
  metaapi_account_id: string | null
  connection_status: string | null
  account_login?: string | null
  broker_server?: string | null
  auto_reconnect_enabled?: boolean | null
  mt_password_encrypted?: string | null
}

const KEEPER_INTERVAL_MS = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.BROKER_SESSION_HEARTBEAT_MS ?? 10_000) || 10_000),
)

/** After this long in recovering, mark error (unless wrong_password already classified). */
const RECOVERING_ERROR_AFTER_MS = Math.max(
  5 * 60_000,
  Number(process.env.BROKER_RECOVERING_ERROR_AFTER_MS ?? 30 * 60_000) || 30 * 60_000,
)

const recoveringSince = new Map<string, number>()
const attemptCounts = new Map<string, number>()

export class BrokerConnectionKeeper {
  private timer: NodeJS.Timeout | null = null
  private tickInFlight = false

  constructor(private readonly supabase: SupabaseClient) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, KEEPER_INTERVAL_MS)
    this.timer.unref?.()
    console.log(`[brokerKeeper] started interval=${KEEPER_INTERVAL_MS}ms`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private clientFor(platform: string) {
    return getMetatraderApi(mtPlatformFrom(platform))
  }

  private noteRecoveringStart(brokerId: string): void {
    if (!recoveringSince.has(brokerId)) {
      recoveringSince.set(brokerId, Date.now())
    }
  }

  private clearRecovering(brokerId: string): void {
    recoveringSince.delete(brokerId)
    attemptCounts.delete(brokerId)
  }

  private async maybeMarkProlongedFailure(
    row: BrokerKeeperRow,
    rawError?: string,
    errorKind?: BrokerConnectErrorKind,
  ): Promise<void> {
    if (!hasStoredCredentials(row)) {
      if (row.connection_status !== 'error') {
        await writeBrokerConnectionStatus(this.supabase, row.id, 'error', {
          rawError: rawError ?? 'Broker session is not connected',
          errorKind,
        })
      }
      return
    }

    const started = recoveringSince.get(row.id) ?? Date.now()
    if (Date.now() - started < RECOVERING_ERROR_AFTER_MS) {
      if (row.connection_status !== 'recovering') {
        await writeBrokerConnectionStatus(this.supabase, row.id, 'recovering')
      }
      return
    }

    if (errorKind === 'wrong_password' || errorKind === 'credentials_rejected' || errorKind === 'investor_password') {
      await writeBrokerConnectionStatus(this.supabase, row.id, 'error', {
        rawError: rawError ?? 'Broker credentials rejected',
        errorKind,
      })
      this.clearRecovering(row.id)
      return
    }

    if (row.connection_status !== 'error') {
      await writeBrokerConnectionStatus(this.supabase, row.id, 'error', {
        rawError: rawError ?? 'Automatic reconnect failed after extended retry',
        errorKind: errorKind ?? 'session_expired',
      })
    }
    this.clearRecovering(row.id)
  }

  private async tick(): Promise<void> {
    if (!hasMetatraderApiConfigured()) return
    if (this.tickInFlight) return
    this.tickInFlight = true
    try {
      const brokersQ = await applyShardToQuery(
        this.supabase,
        this.supabase
          .from('broker_accounts')
          .select('id,platform,metaapi_account_id,connection_status,account_login,broker_server,auto_reconnect_enabled,mt_password_encrypted')
          .not('metaapi_account_id', 'is', null),
      )
      if (!brokersQ) return
      const { data, error } = await brokersQ
      if (error) {
        console.warn('[brokerKeeper] load brokers failed:', error.message)
        return
      }

      const rows = (data ?? []) as BrokerKeeperRow[]
      let lastServerKey: string | null = null
      let alive = 0
      let recovered = 0
      let recovering = 0

      for (const row of rows) {
        const uuid = row.metaapi_account_id?.trim()
        if (!isMtUuid(uuid)) continue
        lastServerKey = await pauseIfSameMtServer(lastServerKey, row.platform, row.broker_server)
        const api = this.clientFor(row.platform)
        if (!api) continue

        const status = await api.keepSessionAliveDetailed(uuid!)
        if (status === 'alive') {
          alive++
          this.clearRecovering(row.id)
          if (row.connection_status === 'error' || row.connection_status === 'recovering') {
            await writeBrokerConnectionStatus(this.supabase, row.id, 'connected')
            recovered++
          }
          continue
        }

        if (status !== 'session_gone') {
          await new Promise(r => setTimeout(r, 1500))
          const retry = await api.keepSessionAliveDetailed(uuid!)
          if (retry === 'alive') {
            alive++
            this.clearRecovering(row.id)
            if (row.connection_status === 'error' || row.connection_status === 'recovering') {
              await writeBrokerConnectionStatus(this.supabase, row.id, 'connected')
              recovered++
            }
            continue
          }
        }

        if (!hasStoredCredentials(row)) {
          await this.maybeMarkProlongedFailure(row, 'Broker session is not connected — reconnect required')
          continue
        }

        const attempt = (attemptCounts.get(row.id) ?? 0) + 1
        attemptCounts.set(row.id, attempt)
        this.noteRecoveringStart(row.id)
        recovering++
        await writeBrokerConnectionStatus(this.supabase, row.id, 'recovering')

        console.log(
          `[brokerKeeper] broker=${row.id} status=recovering attempt=${attempt} reason=${status}`,
        )

        const hardOk = await hardReconnectBrokerSession(this.supabase, api, {
          id: row.id,
          platform: row.platform,
          metaapi_account_id: uuid!,
          account_login: row.account_login,
          broker_server: row.broker_server,
          auto_reconnect_enabled: row.auto_reconnect_enabled,
          mt_password_encrypted: row.mt_password_encrypted,
        })

        if (hardOk) {
          this.clearRecovering(row.id)
          recovered++
          continue
        }

        await this.maybeMarkProlongedFailure(row, 'Hard reconnect failed')
      }

      if (recovered > 0 || recovering > 0) {
        console.log(`[brokerKeeper] tick alive=${alive} recovered=${recovered} recovering=${recovering}`)
      }
    } finally {
      this.tickInFlight = false
    }
  }
}
