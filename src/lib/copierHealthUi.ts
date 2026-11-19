import type { CopierHealthSnapshot } from './copierHealthStatus'

/** User-facing banner kinds derived only from copier_listener_health. */
export type CopierHealthBannerKind =
  | 'none'
  | 'reconnect_required'
  | 'reconnecting'
  | 'linked_not_receiving'
  | 'offline'

export type CopierHealthUiFlags = {
  telegramLive: boolean
  telegramReconnectRequired: boolean
  telegramReconnecting: boolean
  telegramOffline: boolean
  linkedNotReceiving: boolean
  bannerKind: CopierHealthBannerKind
}

/**
 * Single mapping for CopierStatusCard / Copier Engine / CopierHealthBanner.
 * Lease freshness is intentionally ignored — use health only.
 */
export function deriveCopierHealthUi(
  health: CopierHealthSnapshot,
  opts?: { hasTelegramSession?: boolean },
): CopierHealthUiFlags {
  const hasSession = opts?.hasTelegramSession !== false
  const telegramReconnectRequired =
    health.telegramAccountStatus === 'reconnect_required'
    || health.telegramAccountStatus === 'invalid'
  const telegramLive =
    health.copierEngineStatus === 'operational'
    || (
      health.signalListenerStatus === 'connected'
      && health.mtprotoConnected
      && health.probeFresh
      && !telegramReconnectRequired
    )
  const telegramReconnecting = health.signalListenerStatus === 'reconnecting'
  // Distinct from hard offline: session/listener row says connected but
  // MTProto or probe is not ready (lease renew while disconnected).
  const linkedNotReceiving =
    hasSession
    && !telegramLive
    && !telegramReconnectRequired
    && !telegramReconnecting
    && (
      health.signalListenerStatus === 'connected'
      || (!health.mtprotoConnected && health.workerOwnershipStatus === 'owned')
    )
  const telegramOffline =
    !telegramLive
    && !linkedNotReceiving
    && (
      health.signalListenerStatus === 'disconnected'
      || health.signalListenerStatus === 'failed'
      || health.copierEngineStatus === 'offline'
      || health.workerOwnershipStatus === 'unowned'
      || health.workerOwnershipStatus === 'stale'
    )

  let bannerKind: CopierHealthBannerKind = 'none'
  if (!hasSession) bannerKind = 'none'
  else if (telegramReconnectRequired) bannerKind = 'reconnect_required'
  else if (telegramReconnecting) bannerKind = 'reconnecting'
  else if (linkedNotReceiving) bannerKind = 'linked_not_receiving'
  else if (telegramOffline || health.copierEngineStatus === 'offline') bannerKind = 'offline'

  return {
    telegramLive,
    telegramReconnectRequired,
    telegramReconnecting,
    telegramOffline,
    linkedNotReceiving,
    bannerKind,
  }
}

/** Show the dashboard warning banner for this health snapshot. */
export function shouldShowCopierHealthBanner(
  health: CopierHealthSnapshot,
  opts: { hasTelegramSession: boolean; hasActiveSubscription: boolean },
): boolean {
  if (!opts.hasTelegramSession || !opts.hasActiveSubscription) return false
  const { bannerKind } = deriveCopierHealthUi(health, { hasTelegramSession: true })
  return bannerKind !== 'none' && bannerKind !== 'reconnecting'
}
