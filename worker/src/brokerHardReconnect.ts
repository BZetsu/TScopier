import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetatraderApiClient } from './metatraderapi'
import { decryptMtPassword, isBrokerCredentialsCryptoConfigured } from './brokerCredentialsCrypto'
import { writeBrokerConnectionStatus } from './brokerConnectionStatus'
import { withDistributedMtServerConnectLock } from './mtServerConnectLock'

export interface BrokerHardReconnectRow {
  id: string
  platform: string
  metaapi_account_id: string
  account_login?: string | null
  broker_server?: string | null
  auto_reconnect_enabled?: boolean | null
  mt_password_encrypted?: string | null
}

async function fetchSummaryWithRetry(
  api: MetatraderApiClient,
  uuid: string,
): Promise<Awaited<ReturnType<MetatraderApiClient['accountSummary']>> | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const s = await api.accountSummary(uuid)
      if (s && (s.balance != null || s.equity != null || s.currency)) return s
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 400 + i * 350))
  }
  return null
}

export async function hardReconnectBrokerSession(
  supabase: SupabaseClient,
  api: MetatraderApiClient,
  row: BrokerHardReconnectRow,
): Promise<boolean> {
  if (!row.auto_reconnect_enabled || !row.mt_password_encrypted) return false

  if (!isBrokerCredentialsCryptoConfigured()) {
    console.warn(`[brokerConnection] broker=${row.id} hard reconnect skipped — BROKER_CREDENTIALS_ENCRYPTION_KEY not configured`)
    return false
  }

  const password = decryptMtPassword(row.mt_password_encrypted)
  const login = String(row.account_login ?? '').trim()
  const server = String(row.broker_server ?? '').trim()
  const uuid = row.metaapi_account_id.trim()
  if (!password || !login || !server || !uuid) {
    if (row.auto_reconnect_enabled && row.mt_password_encrypted && !password) {
      console.warn(`[brokerConnection] broker=${row.id} stored password decrypt failed — check BROKER_CREDENTIALS_ENCRYPTION_KEY`)
    }
    return false
  }

  const runConnectEx = async (): Promise<boolean> => {
    await withDistributedMtServerConnectLock(supabase, row.platform, server, () =>
      api.connectEx({ id: uuid, server, login, password }),
    )
    const alive = await api.keepSessionAlive(uuid)
    if (!alive) return false
    const ready = await api.verifyTradingReady(uuid)
    if (ready) return true
    const summary = await fetchSummaryWithRetry(api, uuid)
    return summary != null
  }

  try {
    let ok = await runConnectEx()
    if (!ok) {
      const tokenAlive = await api.keepSessionAlive(uuid)
      if (tokenAlive) {
        const ready = await api.verifyTradingReady(uuid)
        ok = ready || (await fetchSummaryWithRetry(api, uuid)) != null
      }
    }
    if (!ok) {
      ok = await runConnectEx()
    }
    if (!ok) return false

    const summary = await fetchSummaryWithRetry(api, uuid)

    await supabase
      .from('broker_accounts')
      .update({
        connection_status: 'connected',
        connection_error_kind: null,
        connection_error_message: null,
        last_synced_at: new Date().toISOString(),
        ...(summary
          ? {
              last_balance: summary.balance ?? null,
              last_equity: summary.equity ?? null,
              last_currency: summary.currency ?? null,
            }
          : {}),
      })
      .eq('id', row.id)

    await writeBrokerConnectionStatus(supabase, row.id, 'connected')
    console.log(`[brokerConnection] broker=${row.id} hard-reconnected with stored credentials`)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[brokerConnection] broker=${row.id} hard reconnect failed: ${msg}`)
    await writeBrokerConnectionStatus(supabase, row.id, 'error', { rawError: msg })
    return false
  }
}
