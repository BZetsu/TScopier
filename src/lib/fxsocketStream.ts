import { ensureFreshAuthSession } from './fxsocketBroker'
import type { FxsocketStreamMessage, FxsocketStreamSubscribeFrame } from './fxsocketStreamTypes'

export type { FxsocketStreamMessage, FxsocketStreamSubscribeFrame, FxsocketStreamTopic } from './fxsocketStreamTypes'

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
  const token = await ensureFreshAuthSession()
  const url = workerStreamUrl(brokerAccountId, token)
  let ws: WebSocket | null = new WebSocket(url)
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  const notifyState = (connected: boolean) => handlers.onStateChange?.(connected)

  const connect = () => {
    if (closed) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      reconnectAttempt = 0
      notifyState(true)
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as FxsocketStreamMessage
        handlers.onMessage?.(msg)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onerror = () => {
      handlers.onError?.('Live broker stream connection error')
    }
    ws.onclose = () => {
      notifyState(false)
      if (closed) return
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt)
      reconnectAttempt += 1
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  const sendFrame = (frame: Record<string, unknown>) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(frame))
  }

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
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
