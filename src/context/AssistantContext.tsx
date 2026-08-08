import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import {
  loadAssistantHistory,
  saveAssistantHistory,
  type AssistantChatMessage,
  type PendingClientAction,
  type PendingConfirmation,
} from '../lib/assistantClient'

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
  persistMessages: (next: AssistantChatMessage[]) => void
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

  const openAssistant = useCallback(() => {
    if (userId) {
      setMessages(loadAssistantHistory(userId))
    }
    setOpen(true)
  }, [userId])

  const closeAssistant = useCallback(() => setOpen(false), [])

  const persistMessages = useCallback(
    (next: AssistantChatMessage[]) => {
      setMessages(next)
      if (userId) saveAssistantHistory(userId, next)
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
    }),
    [
      open,
      openAssistant,
      closeAssistant,
      messages,
      pendingConfirmations,
      pendingClientActions,
      persistMessages,
    ],
  )

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}
