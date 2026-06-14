import { useEffect, useMemo, useRef } from 'react'
import { openFxsocketStream, type FxsocketStreamMessage } from '../lib/fxsocketStream'
import {
  parseFxsocketAccountStreamData,
  parseFxsocketPositionsStreamData,
  type FxsocketAccountStreamSnapshot,
  type FxsocketPositionsStreamSnapshot,
} from '../lib/fxsocketStreamParse'
import { isFxsocketLinkedBroker } from '../lib/brokerLink'
import type { BrokerAccount } from '../types/database'

export interface FxsocketStreamHandlers {
  onAccount?: (brokerAccountId: string, data: FxsocketAccountStreamSnapshot) => void
  onPositions?: (brokerAccountId: string, snapshot: FxsocketPositionsStreamSnapshot) => void
  onTerminal?: (brokerAccountId: string, data: Record<string, unknown>) => void
  onTrade?: (brokerAccountId: string, data: Record<string, unknown>) => void
}

export function useFxsocketStream(
  brokers: BrokerAccount[],
  handlers: FxsocketStreamHandlers,
  enabled = true,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const streamBrokerIds = useMemo(
    () => brokers.filter(isFxsocketLinkedBroker).map(b => b.id).sort().join(','),
    [brokers],
  )

  useEffect(() => {
    if (!enabled || !streamBrokerIds) return

    const linked = brokers.filter(isFxsocketLinkedBroker)
    if (linked.length === 0) return

    const handles = new Map<string, { close: () => void }>()
    let cancelled = false

    for (const broker of linked) {
      void openFxsocketStream(broker.id, {
        onMessage: (msg: FxsocketStreamMessage) => {
          if (msg.type === 'account' && 'data' in msg) {
            const snap = parseFxsocketAccountStreamData(msg.data as Record<string, unknown>)
            handlersRef.current.onAccount?.(broker.id, snap)
          } else if (msg.type === 'positions' && 'data' in msg) {
            handlersRef.current.onPositions?.(
              broker.id,
              parseFxsocketPositionsStreamData(msg.data),
            )
          } else if (msg.type === 'terminal' && 'data' in msg) {
            handlersRef.current.onTerminal?.(broker.id, msg.data as Record<string, unknown>)
          } else if (msg.type === 'trade' && 'data' in msg) {
            handlersRef.current.onTrade?.(broker.id, msg.data as Record<string, unknown>)
          }
        },
      }).then(handle => {
        if (cancelled) {
          handle.close()
          return
        }
        handles.set(broker.id, handle)
      }).catch(() => {
        /* stream setup failed — dashboard falls back to cached values */
      })
    }

    return () => {
      cancelled = true
      for (const handle of handles.values()) handle.close()
    }
  }, [streamBrokerIds, brokers, enabled])
}
