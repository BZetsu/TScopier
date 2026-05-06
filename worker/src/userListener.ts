import { SupabaseClient } from '@supabase/supabase-js'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import type { NewMessageEvent } from 'telegram/events/NewMessage'

const API_ID = parseInt(process.env.TELEGRAM_API_ID ?? '0')
const API_HASH = process.env.TELEGRAM_API_HASH ?? ''
const PARSE_SIGNAL_URL = process.env.PARSE_SIGNAL_URL ?? ''
const PARSE_SIGNAL_KEY = process.env.PARSE_SIGNAL_KEY ?? ''

export class UserListener {
  private client: TelegramClient
  private userId: string
  private supabase: SupabaseClient
  private monitoredChannels = new Set<string>()

  constructor(userId: string, sessionString: string, supabase: SupabaseClient) {
    this.userId = userId
    this.supabase = supabase
    this.client = new TelegramClient(
      new StringSession(sessionString),
      API_ID,
      API_HASH,
      { connectionRetries: 5, retryDelay: 3000 }
    )
  }

  async start() {
    await this.client.connect()
    await this.loadChannels()

    this.client.addEventHandler(
      (event: NewMessageEvent) => this.handleMessage(event),
      new NewMessage({})
    )

    // Refresh channel list every 5 minutes
    setInterval(() => this.loadChannels(), 5 * 60 * 1000)
  }

  async stop() {
    try {
      await this.client.disconnect()
    } catch {
      // ignore disconnect errors
    }
  }

  private async loadChannels() {
    const { data } = await this.supabase
      .from('telegram_channels')
      .select('channel_id, channel_username')
      .eq('user_id', this.userId)
      .eq('is_active', true)

    this.monitoredChannels.clear()
    for (const ch of data ?? []) {
      if (ch.channel_id) this.monitoredChannels.add(ch.channel_id)
      if (ch.channel_username) this.monitoredChannels.add(ch.channel_username.toLowerCase())
    }
  }

  private async handleMessage(event: NewMessageEvent) {
    try {
      const message = event.message
      if (!message) return

      // Get sender/chat entity
      const chat = await message.getChat()
      if (!chat) return

      const chatId = String((chat as { id?: bigint | number }).id ?? '')
      const chatUsername = ((chat as { username?: string }).username ?? '').toLowerCase()

      // Only process messages from monitored channels
      const isMonitored =
        this.monitoredChannels.has(chatId) ||
        (chatUsername && this.monitoredChannels.has(chatUsername))

      if (!isMonitored) return

      // Find the channel record
      const { data: channelRow } = await this.supabase
        .from('telegram_channels')
        .select('id')
        .eq('user_id', this.userId)
        .or(`channel_id.eq.${chatId},channel_username.eq.${chatUsername}`)
        .maybeSingle()

      const rawMessage = message.text ?? ''
      const isReply = !!message.replyTo

      // Insert signal record
      const { data: signalRow, error: insertErr } = await this.supabase
        .from('signals')
        .insert({
          user_id: this.userId,
          channel_id: channelRow?.id ?? null,
          raw_message: rawMessage,
          raw_image_url: null,
          status: 'pending',
          telegram_message_id: String(message.id),
          is_modification: isReply,
          parent_signal_id: null,
        })
        .select('id')
        .single()

      if (insertErr || !signalRow) {
        console.error(`[userListener] Failed to insert signal for user ${this.userId}:`, insertErr?.message)
        return
      }

      // Fire parse-signal edge function asynchronously
      fetch(PARSE_SIGNAL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PARSE_SIGNAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signal_id: signalRow.id }),
      }).catch(err => {
        console.error(`[userListener] Failed to call parse-signal for signal ${signalRow.id}:`, err.message)
      })

    } catch (err) {
      console.error(`[userListener] handleMessage error for user ${this.userId}:`, err)
    }
  }
}
