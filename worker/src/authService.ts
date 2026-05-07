import { SupabaseClient } from '@supabase/supabase-js'
import { TelegramClient } from 'telegram'
import { Api } from 'telegram/tl'
import { computeCheck } from 'telegram/Password'
import { buildClient, tgInvoke, API_ID, API_HASH } from './telegramClient'
import { UserSessionManager } from './sessionManager'

interface PendingAuth {
  client: TelegramClient
  phone: string
  phoneCodeHash: string
  createdAt: number
}

/**
 * Maximum age of a pending auth (between send_code and verify_code)
 * before we drop the client. Telegram's own code expiration is ~5 min.
 */
const PENDING_TTL_MS = 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

export type VerifyResult =
  | { ok: true; session_id: string }
  | { requires_password: true }

/**
 * Owns the MTProto connection during the send_code -> verify_code window.
 * The same TelegramClient is kept alive across both calls so we never re-auth
 * to a different DC. On success the live client is handed off to the
 * UserSessionManager and becomes the long-running listener client — there
 * is exactly one TCP connection per user from auth onward.
 */
export class AuthService {
  private pending = new Map<string, PendingAuth>()
  private cleanupTimer: NodeJS.Timeout

  constructor(
    private supabase: SupabaseClient,
    private sessionManager: UserSessionManager,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref()
  }

  shutdown() {
    clearInterval(this.cleanupTimer)
    for (const [, p] of this.pending) {
      p.client.disconnect().catch(() => {})
    }
    this.pending.clear()
  }

  private cleanup() {
    const now = Date.now()
    for (const [userId, p] of this.pending) {
      if (now - p.createdAt > PENDING_TTL_MS) {
        p.client.disconnect().catch(() => {})
        this.pending.delete(userId)
        console.log(`[authService] expired pending auth for user ${userId}`)
      }
    }
  }

  async sendCode(userId: string, phone: string): Promise<{ phone_code_hash: string }> {
    const existing = this.pending.get(userId)
    if (existing) {
      try { await existing.client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
    }

    const client = buildClient('')
    await client.connect()

    try {
      const result = await tgInvoke<Api.auth.SentCode>(
        client,
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: API_ID,
          apiHash: API_HASH,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: true,
            allowAppHash: true,
          }),
        })
      )

      this.pending.set(userId, {
        client,
        phone,
        phoneCodeHash: result.phoneCodeHash,
        createdAt: Date.now(),
      })

      return { phone_code_hash: result.phoneCodeHash }
    } catch (err) {
      try { await client.disconnect() } catch { /* ignore */ }
      throw err
    }
  }

  async verifyCode(userId: string, code: string, password?: string): Promise<VerifyResult> {
    const pending = this.pending.get(userId)
    if (!pending) {
      throw new Error('No pending auth flow. Call send_code first.')
    }

    const { client, phone, phoneCodeHash } = pending

    try {
      if (password) {
        // Code path 2: user re-submitted with password after first attempt asked for it.
        try {
          await tgInvoke(client, new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode: code,
          }))
        } catch (signInErr: unknown) {
          const msg = signInErr instanceof Error ? signInErr.message : String(signInErr)
          if (!msg.includes('SESSION_PASSWORD_NEEDED')) throw signInErr
        }
        const srpResult = await tgInvoke<Api.account.Password>(client, new Api.account.GetPassword())
        const srpCheck = await computeCheck(srpResult, password)
        await tgInvoke(client, new Api.auth.CheckPassword({ password: srpCheck }))
      } else {
        try {
          await tgInvoke(client, new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode: code,
          }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('SESSION_PASSWORD_NEEDED')) {
            // Keep the pending client alive — frontend will resend with password.
            return { requires_password: true }
          }
          throw err
        }
      }
    } catch (err) {
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      throw err
    }

    const sessionString = (client.session.save() as unknown) as string

    const { data: row, error: dbErr } = await this.supabase
      .from('telegram_sessions')
      .upsert({
        user_id: userId,
        session_string: sessionString,
        phone_number: phone,
        is_active: true,
      }, { onConflict: 'user_id' })
      .select('id')
      .single()

    if (dbErr || !row) {
      try { await client.disconnect() } catch { /* ignore */ }
      this.pending.delete(userId)
      throw new Error(dbErr?.message ?? 'Failed to persist Telegram session')
    }

    // Hand the *live* authenticated client to the session manager so it
    // becomes the long-running listener — no second connect from this host.
    this.pending.delete(userId)
    try {
      await this.sessionManager.adoptClient(userId, client, sessionString)
    } catch (err) {
      console.error(`[authService] adoptClient failed for ${userId}:`, err)
      // Session is persisted; manager will pick it up on next syncSessions tick.
    }

    return { ok: true, session_id: row.id as string }
  }
}
