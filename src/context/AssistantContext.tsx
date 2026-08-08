import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import {
  loadAssistantHistory,
  saveAssistantHistory,
  type AssistantChatMessage,
  type PendingClientAction,
  type PendingConfirmation,
} from '../lib/assistantClient'
import {
  INITIAL_TELEGRAM_LINK_STATE,
  type AssistantTelegramLinkState,
} from '../lib/assistantTelegramLink'
import {
  brokerConnectFromPrefill,
  INITIAL_BROKER_CONNECT_STATE,
  type AssistantBrokerConnectPrefill,
  type AssistantBrokerConnectState,
} from '../lib/assistantBrokerConnect'

type AssistantContextValue = {
  open: boolean
  openAssistant: () => void
  closeAssistant: () => void
  messages: AssistantChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<AssistantChatMessage[]>>
  pendingConfirmations: PendingConfirmation[]
  setPendingConfirmations: React.Dispatch<React.SetStateAction<PendingConfirmation[]>>
  pendingClientActions: PendingClientAction[]
  setPendingClientActions: React.Dispatch<React.SetStateAction<PendingClientAction[]>>
  persistMessages: (
    next: AssistantChatMessage[] | ((prev: AssistantChatMessage[]) => AssistantChatMessage[]),
  ) => void
  telegramLink: AssistantTelegramLinkState
  setTelegramLink: React.Dispatch<React.SetStateAction<AssistantTelegramLinkState>>
  startTelegramLinkFlow: () => void
  resetTelegramLinkFlow: () => void
  brokerConnect: AssistantBrokerConnectState
  setBrokerConnect: React.Dispatch<React.SetStateAction<AssistantBrokerConnectState>>
  startBrokerConnectFlow: (prefill?: AssistantBrokerConnectPrefill | null) => void
  resetBrokerConnectFlow: () => void
}

const AssistantContext = createContext<AssistantContextValue | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AssistantChatMessage[]>(() =>
    userId ? loadAssistantHistory(userId) : [],
  )
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([])
  const [pendingClientActions, setPendingClientActions] = useState<PendingClientAction[]>([])
  const [telegramLink, setTelegramLink] = useState<AssistantTelegramLinkState>(INITIAL_TELEGRAM_LINK_STATE)
  const [brokerConnect, setBrokerConnect] = useState<AssistantBrokerConnectState>(
    INITIAL_BROKER_CONNECT_STATE,
  )

  const resetTelegramLinkFlow = useCallback(() => {
    setTelegramLink(INITIAL_TELEGRAM_LINK_STATE)
  }, [])

  const startTelegramLinkFlow = useCallback(() => {
    setBrokerConnect(INITIAL_BROKER_CONNECT_STATE)
    setTelegramLink({
      ...INITIAL_TELEGRAM_LINK_STATE,
      stage: 'phone',
    })
  }, [])

  const resetBrokerConnectFlow = useCallback(() => {
    setBrokerConnect(INITIAL_BROKER_CONNECT_STATE)
  }, [])

  const startBrokerConnectFlow = useCallback((prefill?: AssistantBrokerConnectPrefill | null) => {
    setTelegramLink(INITIAL_TELEGRAM_LINK_STATE)
    setBrokerConnect(brokerConnectFromPrefill(prefill))
  }, [])

  const openAssistant = useCallback(() => {
    if (userId) {
      setMessages(loadAssistantHistory(userId))
    }
    setOpen(true)
  }, [userId])

  const closeAssistant = useCallback(() => setOpen(false), [])

  const persistMessages = useCallback(
    (next: AssistantChatMessage[] | ((prev: AssistantChatMessage[]) => AssistantChatMessage[])) => {
      setMessages(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (userId) saveAssistantHistory(userId, resolved)
        return resolved
      })
    },
    [userId],
  )

  const value = useMemo(
    () => ({
      open,
      openAssistant,
      closeAssistant,
      messages,
      setMessages,
      pendingConfirmations,
      setPendingConfirmations,
      pendingClientActions,
      setPendingClientActions,
      persistMessages,
      telegramLink,
      setTelegramLink,
      startTelegramLinkFlow,
      resetTelegramLinkFlow,
      brokerConnect,
      setBrokerConnect,
      startBrokerConnectFlow,
      resetBrokerConnectFlow,
    }),
    [
      open,
      openAssistant,
      closeAssistant,
      messages,
      pendingConfirmations,
      pendingClientActions,
      persistMessages,
      telegramLink,
      startTelegramLinkFlow,
      resetTelegramLinkFlow,
      brokerConnect,
      startBrokerConnectFlow,
      resetBrokerConnectFlow,
    ],
  )

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}
