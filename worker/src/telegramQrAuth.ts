/** Build the tg:// URL encoded in Telegram QR login codes (GramJS/Telegram desktop). */
export function formatQrLoginUrl(token: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(token) ? token : Buffer.from(token)
  return `tg://login?token=${buf.toString('base64url')}`
}

export type QrLoginStatus = 'waiting' | 'requires_password' | 'success' | 'error'

export type QrStatusResponse = {
  status: QrLoginStatus
  qr_url?: string
  expires_at?: string
  requires_password?: boolean
  session_id?: string
  channels?: unknown[]
  error?: string
}

export type QrPendingSnapshot = {
  status: QrLoginStatus
  latestQrUrl?: string
  expiresAt?: number
  error?: string
  result?: { session_id: string; channels?: unknown[] }
}

/** When QR pending was cleared after a successful link, polls should still complete. */
export function qrStatusFromActiveSession(sessionId: string, channels?: unknown[]): QrStatusResponse {
  return {
    status: 'success',
    session_id: sessionId,
    channels: channels ?? [],
  }
}

function formatExpiresAt(expiresAt?: number): string | undefined {
  return expiresAt && expiresAt > 0 ? new Date(expiresAt).toISOString() : undefined
}

/** Map in-memory QR pending auth to a poll API response. */
export function buildQrStatusFromPending(pending: QrPendingSnapshot): QrStatusResponse {
  if (pending.status === 'success' && pending.result) {
    return {
      status: 'success',
      session_id: pending.result.session_id,
      channels: pending.result.channels ?? [],
    }
  }
  // Success was marked but finalizeAuth is still writing session/channels — keep polling.
  if (pending.status === 'success') {
    return {
      status: 'waiting',
      qr_url: pending.latestQrUrl,
      expires_at: formatExpiresAt(pending.expiresAt),
    }
  }
  if (pending.status === 'error') {
    return { status: 'error', error: pending.error ?? 'QR login failed' }
  }
  if (pending.status === 'requires_password') {
    return {
      status: 'requires_password',
      requires_password: true,
      qr_url: pending.latestQrUrl || undefined,
      expires_at: formatExpiresAt(pending.expiresAt),
    }
  }
  return {
    status: 'waiting',
    qr_url: pending.latestQrUrl,
    expires_at: formatExpiresAt(pending.expiresAt),
  }
}
