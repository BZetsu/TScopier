import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type SupportTypingRole = 'user' | 'agent'

type TypingPayload = {
  role: SupportTypingRole
  typing: boolean
}

const IDLE_MS = 2000
const DISPLAY_MS = 3000

export function supportTypingChannelName(conversationId: string): string {
  return `support-typing:${conversationId}`
}

/**
 * One channel per conversation for both sending and receiving typing signals.
 */
export function createSupportTypingSession(params: {
  conversationId: string
  selfRole: SupportTypingRole
  onPeerTyping: (typing: boolean) => void
}): {
  signal: () => void
  stop: () => void
  dispose: () => void
} {
  let displayTimer: number | null = null
  let idleTimer: number | null = null
  let sentTyping = false

  const channel: RealtimeChannel = supabase.channel(
    supportTypingChannelName(params.conversationId),
    { config: { broadcast: { self: false } } },
  )

  channel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const data = payload as TypingPayload
      if (!data || data.role === params.selfRole) return
      if (displayTimer) window.clearTimeout(displayTimer)
      if (data.typing) {
        params.onPeerTyping(true)
        displayTimer = window.setTimeout(() => params.onPeerTyping(false), DISPLAY_MS)
      } else {
        params.onPeerTyping(false)
      }
    })
    .subscribe()

  const send = (typing: boolean) => {
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { role: params.selfRole, typing } satisfies TypingPayload,
    })
  }

  const stop = () => {
    if (idleTimer) {
      window.clearTimeout(idleTimer)
      idleTimer = null
    }
    if (sentTyping) {
      sentTyping = false
      send(false)
    }
  }

  const signal = () => {
    if (!sentTyping) {
      sentTyping = true
      send(true)
    }
    if (idleTimer) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      idleTimer = null
      sentTyping = false
      send(false)
    }, IDLE_MS)
  }

  const dispose = () => {
    stop()
    if (displayTimer) window.clearTimeout(displayTimer)
    params.onPeerTyping(false)
    void supabase.removeChannel(channel)
  }

  return { signal, stop, dispose }
}
