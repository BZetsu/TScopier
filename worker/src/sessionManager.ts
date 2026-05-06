import { SupabaseClient } from '@supabase/supabase-js'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import type { NewMessageEvent } from 'telegram/events/NewMessage'
import { UserListener } from './userListener'

export class UserSessionManager {
  private listeners = new Map<string, UserListener>()
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async loadAll() {
    const { data: sessions, error } = await this.supabase
      .from('telegram_sessions')
      .select('user_id, session_string, phone_number')
      .eq('is_active', true)

    if (error) {
      console.error('[sessionManager] Failed to load sessions:', error.message)
      return
    }

    console.log(`[sessionManager] Loading ${sessions?.length ?? 0} sessions`)

    for (const session of sessions ?? []) {
      await this.startListener(session.user_id, session.session_string)
    }
  }

  async syncSessions() {
    const { data: sessions } = await this.supabase
      .from('telegram_sessions')
      .select('user_id, session_string, is_active')

    const activeSessions = new Set((sessions ?? []).filter(s => s.is_active).map(s => s.user_id))

    // Start new listeners
    for (const session of sessions ?? []) {
      if (session.is_active && !this.listeners.has(session.user_id)) {
        await this.startListener(session.user_id, session.session_string)
      }
    }

    // Stop removed listeners
    for (const [userId] of this.listeners) {
      if (!activeSessions.has(userId)) {
        await this.stopListener(userId)
      }
    }
  }

  private async startListener(userId: string, sessionString: string) {
    if (this.listeners.has(userId)) return

    try {
      const listener = new UserListener(userId, sessionString, this.supabase)
      await listener.start()
      this.listeners.set(userId, listener)
      console.log(`[sessionManager] Started listener for user ${userId}`)
    } catch (err) {
      console.error(`[sessionManager] Failed to start listener for ${userId}:`, err)
    }
  }

  private async stopListener(userId: string) {
    const listener = this.listeners.get(userId)
    if (!listener) return
    await listener.stop()
    this.listeners.delete(userId)
    console.log(`[sessionManager] Stopped listener for user ${userId}`)
  }

  async disconnectAll() {
    for (const [userId, listener] of this.listeners) {
      await listener.stop()
      console.log(`[sessionManager] Disconnected ${userId}`)
    }
    this.listeners.clear()
  }
}
