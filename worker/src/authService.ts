import { SupabaseClient } from '@supabase/supabase-js'
import { TelegramClient } from 'telegram'
import { Api } from 'telegram/tl'
import { computeCheck } from 'telegram/Password'
import { buildClient, tgInvoke, API_ID, API_HASH } from './telegramClient'
import { UserSessionManager } from './sessionManager'
import type { ChannelInfo } from './userListener'
import {
  assertTelegramAccountAvailable,
  normalizeTelegramPhoneNumber,
  upsertTelegramAccountClaim,
} from './telegramAccountClaims'
import { buildQrStatusFromPending, formatQrLoginUrl, qrStatusFromActiveSession, type QrStatusResponse } from './telegramQrAuth'

type PhonePending = {
  method: 'phone'
  client: TelegramClient
  phone: string
  phoneCodeHash: string
  createdAt: number
  awaitingPassword?: boolean
}

type QrPending = {
  method: 'qr'
  client: TelegramClient
  latestQrUrl: string
  expiresAt: number
  status: 'waiting' | 'requires_password' | 'success' | 'error'
  createdAt: number
  phone?: string
  error?: string
  result?: { ok: true; session_id: string; channels?: ChannelInfo[] }
  passwordHint?: string
}

type PendingEntry = PhonePending | QrPending

type VerifySuccess = { ok: true; session_id: string; channels?: ChannelInfo[] }

type VerifyResult = VerifySuccess | { requires_password: true }

/**
 * Maximum age of a pending auth (between send_code and verify_code)
 * before we drop the in-memory client. Telegram codes expire in a few minutes;
 * DB-backed recovery lasts slightly longer for cross-replica / slow UX.
 */
const PENDING_TTL_MS = 10 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000
/** DB row outlives Telegram code validity slightly so retries still recover across replicas. */
const PENDING_DB_TTL_MS = 12 * 60 * 1000
const QR_FIRST_TOKEN_WAIT_MS = 15_000
const QR_PASSWORD_WAIT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizePhoneNumber(raw: string): string {
  return normalizeTelegramPhoneNumber(raw)
}

function phonesMatch(a: string, b: string): boolean {
  return normalizePhoneNumber(a) === normalizePhoneNumber(b)
}

function normalizeVerificationCode(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '')
}

/**
 * Owns the MTProto connection during the send_code -> verify_code window.
 * The same TelegramClient is kept alive across both calls so we never re-auth
 * to a different DC. On success the live client is handed off to the
 * UserSessionManager and becomes the long-running listener client — there
 * is exactly one TCP connection per user from auth onward.
 */
export class AuthService {
  private pending = new Map<string, PendingEntry>()
  private qrPasswordResolvers = new Map<string, { resolve: (p: string) => void; reject: (e: Error) => void }>()
  private cleanupTimer: NodeJS.Timeout

  constructor(
    private supabase: SupabaseClient,
    private sessionManager: UserSessionManager,
  ) {
    this.sessionManager.setAuthGuard(userId => this.pending.has(userId))
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref()
  }

  shutdown() {
    clearInterval(this.cleanupTimer)
    for (const [, p] of this.pending) {
      p.client.disconnect().catch(() => {})
    }
    this.pending.clear()
    this.qrPasswordResolvers.clear()
  }

  private cleanup() {
    const now = Date.now()
    for (const [userId, p] of this.pending) {
      if (now - p.createdAt > PENDING_TTL_MS) {
        p.client.disconnect().catch(() => {})
        this.pending.delete(userId)
        this.qrPasswordResolvers.delete(userId)
        console.log(`[authService] expired pending auth for user ${userId}`)
      }
    }
    void this.supabase
      .from('telegram_auth_pending')
      .delete()
      .lt('expires_at', new Date(now).toISOString())
      .then(({ error }) => {
        if (error) console.warn('[authService] telegram_auth_pending cleanup:', error.message)
      })
  }

  private async clearPendingRow(userId: string) {
    await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId)
  }

  private async disconnectPending(userId: string) {
    const existing = this.pending.get(userId)
    if (existing) {
      try { await existing.client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
    }
    this.qrPasswordResolvers.delete(userId)
  }

  /**
   * When verify hits a different process than send_code, rebuild MTProto from the
   * persisted phone_code_hash (same approach as reconnecting after app restart).
   */
  private async restorePhonePendingFromDatabase(userId: string, phone: string): Promise<PhonePending | null> {
    const { data: row, error } = await this.supabase
      .from('telegram_auth_pending')
      .select('phone, phone_code_hash, expires_at, awaiting_password, auth_session_string, auth_method')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !row) return null
    if (row.auth_method === 'qr') return null
    if (new Date(row.expires_at) < new Date()) {
      await this.clearPendingRow(userId)
      return null
    }
    if (!row.phone || !phonesMatch(row.phone, phone)) {
      console.warn(`[authService] verify phone mismatch for user ${userId}`)
      return null
    }

    const awaitingPassword = Boolean(row.awaiting_password)
    const savedSession =
      awaitingPassword && typeof row.auth_session_string === 'string' && row.auth_session_string.trim()
        ? row.auth_session_string.trim()
        : ''

    const client = buildClient(savedSession)
    await client.connect()
    return {
      method: 'phone',
      client,
      phone: row.phone,
      phoneCodeHash: row.phone_code_hash ?? '',
      createdAt: Date.now(),
      awaitingPassword,
    }
  }

  private async restoreQrPendingFromDatabase(userId: string): Promise<QrPending | null> {
    const { data: row, error } = await this.supabase
      .from('telegram_auth_pending')
      .select('expires_at, auth_session_string, awaiting_password, qr_expires_at, phone, auth_method')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !row || row.auth_method !== 'qr') return null
    if (new Date(row.expires_at) < new Date()) {
      await this.clearPendingRow(userId)
      return null
    }

    const sessionString =
      typeof row.auth_session_string === 'string' && row.auth_session_string.trim()
        ? row.auth_session_string.trim()
        : ''
    if (!sessionString) return null

    const client = buildClient(sessionString)
    await client.connect()
    const pending: QrPending = {
      method: 'qr',
      client,
      latestQrUrl: '',
      expiresAt: row.qr_expires_at ? new Date(row.qr_expires_at).getTime() : 0,
      status: row.awaiting_password ? 'requires_password' : 'waiting',
      createdAt: Date.now(),
      phone: row.phone ?? undefined,
    }
    if (pending.status === 'waiting') {
      void this.runQrLoginBackground(userId, pending)
    }
    return pending
  }

  private async persistAwaitingPassword(userId: string, client: TelegramClient): Promise<void> {
    const authSessionString = (client.session.save() as unknown) as string
    const { error } = await this.supabase
      .from('telegram_auth_pending')
      .update({
        awaiting_password: true,
        auth_session_string: authSessionString,
      })
      .eq('user_id', userId)
    if (error) {
      console.warn(`[authService] persistAwaitingPassword failed for ${userId}:`, error.message)
    }
  }

  private async persistQrPendingRow(userId: string, client: TelegramClient, pending: QrPending): Promise<void> {
    const authSessionString = (client.session.save() as unknown) as string
    const expiresAt = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString()
    const { error } = await this.supabase.from('telegram_auth_pending').upsert(
      {
        user_id: userId,
        auth_method: 'qr',
        phone: pending.phone ?? null,
        phone_code_hash: null,
        expires_at: expiresAt,
        auth_session_string: authSessionString,
        awaiting_password: pending.status === 'requires_password',
        qr_expires_at: pending.expiresAt > 0 ? new Date(pending.expiresAt).toISOString() : null,
      },
      { onConflict: 'user_id' },
    )
    if (error) {
      console.warn(`[authService] persistQrPendingRow failed for ${userId}:`, error.message)
    }
  }

  private async completePasswordStep(client: TelegramClient, password: string): Promise<void> {
    const srpResult = await tgInvoke<Api.account.Password>(client, new Api.account.GetPassword())
    const srpCheck = await computeCheck(srpResult, password)
    await tgInvoke(client, new Api.auth.CheckPassword({ password: srpCheck }))
  }

  private async finalizeAuth(
    client: TelegramClient,
    userId: string,
    phone: string,
  ): Promise<VerifySuccess> {
    const sessionString = (client.session.save() as unknown) as string

    const me = await client.getMe()
    const telegramUserId = me.id?.toString?.() ?? String(me.id)
    await assertTelegramAccountAvailable(this.supabase, userId, {
      phone,
      telegramUserId,
    })

    const { data: row, error: dbErr } = await this.supabase
      .from('telegram_sessions')
      .upsert({
        user_id: userId,
        session_string: sessionString,
        phone_number: phone,
        is_active: true,
        listener_engine: 'gramjs',
      }, { onConflict: 'user_id' })
      .select('id')
      .single()

    if (dbErr || !row) {
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      await this.clearPendingRow(userId)
      throw new Error(dbErr?.message ?? 'Failed to persist Telegram session')
    }

    try {
      await upsertTelegramAccountClaim(this.supabase, userId, {
        phone,
        telegramUserId,
      })
    } catch (claimErr) {
      await this.supabase.from('telegram_sessions').delete().eq('user_id', userId)
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      await this.clearPendingRow(userId)
      throw claimErr
    }

    this.pending.delete(userId)
    await this.clearPendingRow(userId)
    let channels: ChannelInfo[] | undefined
    try {
      await this.sessionManager.adoptClient(userId, client, sessionString)
      try {
        channels = await this.sessionManager.listChannelsForAdoptedUser(userId, { skipColdDelay: true })
      } catch (listErr) {
        console.warn(`[authService] listChannels after auth failed for ${userId}:`, listErr)
      }
    } catch (err) {
      console.error(`[authService] adoptClient failed for ${userId}:`, err)
      try {
        await client.disconnect()
      } catch {
        /* ignore */
      }
    }

    return { ok: true, session_id: row.id as string, channels }
  }

  private async runQrLoginBackground(userId: string, pending: QrPending): Promise<void> {
    const { client } = pending
    try {
      await client.signInUserWithQrCode(
        { apiId: API_ID, apiHash: API_HASH },
        {
          qrCode: async ({ token, expires }) => {
            pending.latestQrUrl = formatQrLoginUrl(
              Buffer.isBuffer(token) ? token : Buffer.from(token as Uint8Array),
            )
            pending.expiresAt = expires * 1000
            await this.persistQrPendingRow(userId, client, pending)
          },
          password: async (hint?: string) => {
            pending.status = 'requires_password'
            pending.passwordHint = hint
            await this.persistAwaitingPassword(userId, client)
            return new Promise<string>((resolve, reject) => {
              this.qrPasswordResolvers.set(userId, { resolve, reject })
            })
          },
          onError: async (err: Error) => {
            console.warn(`[authService] QR login onError user=${userId}:`, err.message)
            return false
          },
        },
      )

      const me = await client.getMe()
      const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? ''
      pending.phone = phone
      // Mark success only after finalizeAuth returns. finalizeAuth clears the Map
      // entry — re-attach so the next poll can observe success without racing.
      const result = await this.finalizeAuth(client, userId, phone || `tg:${me.id}`)
      pending.status = 'success'
      pending.result = result
      this.pending.set(userId, pending)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      pending.status = 'error'
      pending.error = msg
      console.error(`[authService] QR login failed user=${userId}:`, msg)
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      await this.clearPendingRow(userId)
    }
  }

  private async getOrRestoreQrPending(userId: string): Promise<QrPending | null> {
    const existing = this.pending.get(userId)
    if (existing?.method === 'qr') return existing
    const restored = await this.restoreQrPendingFromDatabase(userId)
    if (restored) {
      this.pending.set(userId, restored)
      return restored
    }
    return null
  }

  async sendCode(userId: string, phone: string): Promise<{ phone_code_hash: string }> {
    const normalizedPhone = normalizePhoneNumber(phone)
    if (!normalizedPhone || !normalizedPhone.startsWith('+')) {
      throw new Error('Use full phone with country code, e.g. +44...')
    }
    await assertTelegramAccountAvailable(this.supabase, userId, { phone: normalizedPhone })
    await this.sessionManager.pauseForAuth(userId)

    await this.disconnectPending(userId)
    await this.clearPendingRow(userId)

    const client = buildClient('')
    await client.connect()

    try {
      const result = await tgInvoke<Api.auth.SentCode>(
        client,
        new Api.auth.SendCode({
          phoneNumber: normalizedPhone,
          apiId: API_ID,
          apiHash: API_HASH,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: true,
            allowAppHash: true,
          }),
        }),
      )

      this.pending.set(userId, {
        method: 'phone',
        client,
        phone: normalizedPhone,
        phoneCodeHash: result.phoneCodeHash,
        createdAt: Date.now(),
      })

      const expiresAt = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString()
      const { error: dbErr } = await this.supabase.from('telegram_auth_pending').upsert(
        {
          user_id: userId,
          auth_method: 'phone',
          phone: normalizedPhone,
          phone_code_hash: result.phoneCodeHash,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id' },
      )
      if (dbErr) {
        console.error('[authService] telegram_auth_pending upsert:', dbErr.message)
      }

      return { phone_code_hash: result.phoneCodeHash }
    } catch (err) {
      try { await client.disconnect() } catch { /* ignore */ }
      throw err
    }
  }

  async verifyCode(userId: string, phone: string, code: string, password?: string): Promise<VerifyResult> {
    const normalizedPhone = normalizePhoneNumber(phone)
    const normalizedCode = normalizeVerificationCode(code)
    if (!normalizedCode) {
      throw new Error('Verification code is required')
    }
    await this.sessionManager.pauseForAuth(userId, { releaseDelay: false })

    let pending: PhonePending | undefined
    const mem = this.pending.get(userId)
    if (mem?.method === 'phone') pending = mem
    if (!pending) {
      const restored = await this.restorePhonePendingFromDatabase(userId, normalizedPhone)
      if (restored) {
        pending = restored
        this.pending.set(userId, restored)
      }
    }
    if (!pending) {
      throw new Error('No pending auth flow. Call send_code first.')
    }

    const { client, phone: pendingPhone, phoneCodeHash } = pending

    try {
      if (pending.awaitingPassword) {
        if (!password?.trim()) {
          throw new Error('Two-step verification password is required')
        }
        await this.completePasswordStep(client, password.trim())
      } else if (password?.trim()) {
        try {
          await tgInvoke(client, new Api.auth.SignIn({
            phoneNumber: pendingPhone,
            phoneCodeHash,
            phoneCode: normalizedCode,
          }))
        } catch (signInErr: unknown) {
          const msg = signInErr instanceof Error ? signInErr.message : String(signInErr)
          if (!msg.includes('SESSION_PASSWORD_NEEDED')) throw signInErr
          pending.awaitingPassword = true
          await this.persistAwaitingPassword(userId, client)
          await this.completePasswordStep(client, password.trim())
        }
      } else {
        try {
          await tgInvoke(client, new Api.auth.SignIn({
            phoneNumber: pendingPhone,
            phoneCodeHash,
            phoneCode: normalizedCode,
          }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('SESSION_PASSWORD_NEEDED')) {
            pending.awaitingPassword = true
            await this.persistAwaitingPassword(userId, client)
            return { requires_password: true }
          }
          throw err
        }
      }
    } catch (err) {
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      await this.clearPendingRow(userId)
      throw err
    }

    return this.finalizeAuth(client, userId, pendingPhone)
  }

  async startQrLogin(userId: string): Promise<{ qr_url: string; expires_at: string }> {
    await this.sessionManager.pauseForAuth(userId)

    const existing = this.pending.get(userId)
    if (existing?.method === 'qr' && existing.status === 'waiting' && existing.latestQrUrl) {
      return {
        qr_url: existing.latestQrUrl,
        expires_at: new Date(existing.expiresAt).toISOString(),
      }
    }

    await this.disconnectPending(userId)
    await this.clearPendingRow(userId)

    const client = buildClient('')
    await client.connect()

    const pending: QrPending = {
      method: 'qr',
      client,
      latestQrUrl: '',
      expiresAt: 0,
      status: 'waiting',
      createdAt: Date.now(),
    }
    this.pending.set(userId, pending)
    void this.runQrLoginBackground(userId, pending)

    const deadline = Date.now() + QR_FIRST_TOKEN_WAIT_MS
    while (!pending.latestQrUrl && Date.now() < deadline) {
      await sleep(100)
      if (pending.status === 'error') {
        throw new Error(pending.error ?? 'Failed to generate QR code')
      }
    }
    if (!pending.latestQrUrl) {
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      throw new Error('Failed to generate QR code')
    }

    await this.persistQrPendingRow(userId, client, pending)
    return {
      qr_url: pending.latestQrUrl,
      expires_at: new Date(pending.expiresAt).toISOString(),
    }
  }

  async getQrStatus(userId: string): Promise<QrStatusResponse> {
    const pending = await this.getOrRestoreQrPending(userId)
    if (!pending) {
      // finalizeAuth clears pending before the UI poll observes success — recover from session.
      const { data: sess } = await this.supabase
        .from('telegram_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle()
      if (sess?.id) {
        return qrStatusFromActiveSession(String(sess.id))
      }
      throw new Error('NO_PENDING_QR')
    }

    return buildQrStatusFromPending({
      status: pending.status,
      latestQrUrl: pending.latestQrUrl,
      expiresAt: pending.expiresAt,
      error: pending.error,
      result: pending.result,
    })
  }

  async verifyQrPassword(userId: string, password: string): Promise<VerifyResult> {
    const pending = await this.getOrRestoreQrPending(userId)
    if (!pending) {
      throw new Error('NO_PENDING_QR')
    }
    if (pending.status !== 'requires_password') {
      throw new Error('QR not awaiting password')
    }
    if (!password?.trim()) {
      throw new Error('Two-step verification password is required')
    }

    const resolver = this.qrPasswordResolvers.get(userId)
    if (resolver) {
      resolver.resolve(password.trim())
      this.qrPasswordResolvers.delete(userId)
    } else {
      await this.completePasswordStep(pending.client, password.trim())
      const me = await pending.client.getMe()
      const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? ''
      pending.status = 'success'
      pending.result = await this.finalizeAuth(pending.client, userId, phone || `tg:${me.id}`)
      return pending.result
    }

    const deadline = Date.now() + QR_PASSWORD_WAIT_MS
    while (Date.now() < deadline) {
      const current = this.pending.get(userId)
      if (current?.method === 'qr' && current.status === 'success' && current.result) {
        return current.result
      }
      if (current?.method === 'qr' && current.status === 'error') {
        throw new Error(current.error ?? 'QR login failed')
      }
      if (current?.method !== 'qr' || current.status !== 'requires_password') {
        break
      }
      await sleep(200)
    }
    throw new Error('QR login timed out')
  }
}
