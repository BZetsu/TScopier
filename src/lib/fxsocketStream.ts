import { ensureFreshAuthSession } from './fxsocketBroker'
import { normalizeFxsocketStreamMessage } from './fxsocketStreamNormalize'
import type { FxsocketStreamMessage, FxsocketStreamSubscribeFrame, FxsocketStreamTopic } from './fxsocketStreamTypes'

export type { FxsocketStreamMessage, FxsocketStreamSubscribeFrame, FxsocketStreamTopic } from './fxsocketStreamTypes'

const LIVE_BROKER_TOPICS: FxsocketStreamTopic[] = ['account', 'positions', 'trades']

export interface FxsocketStreamHandle {
  close(): void
  subscribe(frame: FxsocketStreamSubscribeFrame): void
  unsubscribe(frame: Omit<FxsocketStreamSubscribeFrame, 'action'>): void
}

function workerStreamUrl(brokerAccountId: string, token: string): string {
  const raw = String(import.meta.env.VITE_WORKER_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('VITE_WORKER_URL is not configured')
  const httpBase = raw.startsWith('http') ? raw : `https://${raw}`
  const u = new URL(httpBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/broker/stream'
  u.search = new URLSearchParams({
    broker_account_id: brokerAccountId,
    token,
  }).toString()
  return u.toString()
}

export async function openFxsocketStream(
  brokerAccountId: string,
  handlers: {
    onMessage?: (msg: FxsocketStreamMessage) => void
    onStateChange?: (connected: boolean) => void
    onError?: (message: string) => void
  },
): Promise<FxsocketStreamHandle> {
  let ws: WebSocket | null = null
  let closed = false
  let connecting = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  const notifyState = (connected: boolean) => handlers.onStateChange?.(connected)

  const sendFrame = (frame: Record<string, unknown>) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(frame))
  }

  const subscribeLiveTopics = () => {
    for (const topic of LIVE_BROKER_TOPICS) {
      sendFrame({ action: 'subscribe', topic })
    }
  }

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return
    const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (closed || connecting) return
    connecting = true
    try {
      const token = await ensureFreshAuthSession()
      const url = workerStreamUrl(brokerAccountId, token)
      try { ws?.close() } catch { /* ignore */ }
      const socket = new WebSocket(url)
      ws = socket

      socket.onopen = () => {
        connecting = false
        reconnectAttempt = 0
        notifyState(true)
        subscribeLiveTopics()
      }
      socket.onmessage = (event) => {
        try {
          const msg = normalizeFxsocketStreamMessage(JSON.parse(String(event.data)))
          if (msg) handlers.onMessage?.(msg)
        } catch {
          /* ignore malformed frames */
        }
      }
      socket.onerror = () => {
        handlers.onError?.('Live broker stream connection error')
      }
      socket.onclose = () => {
        connecting = false
        if (ws === socket) ws = null
        notifyState(false)
        if (!closed) scheduleReconnect()
      }
    } catch {
      connecting = false
      if (!closed) scheduleReconnect()
    }
  }

  void connect()

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws?.close() } catch { /* ignore */ }
      ws = null
    },
    subscribe(frame) {
      sendFrame({ ...frame, action: 'subscribe' })
    },
    unsubscribe(frame) {
      sendFrame({ ...frame, action: 'unsubscribe' })
    },
  }
}
