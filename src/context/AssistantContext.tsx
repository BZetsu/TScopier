import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import {
  assistantThreadTitle,
  createAssistantThreadId,
  loadAssistantThreads,
  MAX_THREADS,
  saveAssistantThreads,
  type AssistantChatMessage,
  type AssistantThread,
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
import { AssistantContext } from './useAssistant'

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AssistantChatMessage[]>(() => {
    if (!userId) return []
    const { activeThreadId, threads } = loadAssistantThreads(userId)
    return threads.find(t => t.id === activeThreadId)?.messages ?? []
  })
  const [threads, setThreads] = useState<AssistantThread[]>(() =>
    userId ? loadAssistantThreads(userId).threads : [],
  )
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() =>
    userId ? loadAssistantThreads(userId).activeThreadId : null,
  )
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([])
  const [pendingClientActions, setPendingClientActions] = useState<PendingClientAction[]>([])
  const [telegramLink, setTelegramLink] = useState<AssistantTelegramLinkState>(INITIAL_TELEGRAM_LINK_STATE)
  const [brokerConnect, setBrokerConnect] = useState<AssistantBrokerConnectState>(
    INITIAL_BROKER_CONNECT_STATE,
  )

  const threadsRef = useRef<AssistantThread[]>(threads)
  const activeThreadIdRef = useRef<string | null>(activeThreadId)

  const syncActiveThread = useCallback((id: string | null) => {
    setActiveThreadId(id)
    activeThreadIdRef.current = id
  }, [])

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
      const state = loadAssistantThreads(userId)
      const target = state.threads.find(t => t.id === state.activeThreadId) ?? state.threads[0] ?? null
      setThreads(state.threads)
      threadsRef.current = state.threads
      syncActiveThread(target?.id ?? null)
      setMessages(target?.messages ?? [])
    }
    setOpen(true)
  }, [userId, syncActiveThread])

  const closeAssistant = useCallback(() => setOpen(false), [])

  const persistMessages = useCallback(
    (
      next: AssistantChatMessage[] | ((prev: AssistantChatMessage[]) => AssistantChatMessage[]),
      ownerThreadId?: string,
    ): string | null => {
      if (!userId) return null
      const targetId = ownerThreadId ?? activeThreadIdRef.current
      const now = Date.now()
      if (!targetId) {
        if (Array.isArray(next) && next.length === 0) return null
        const id = createAssistantThreadId()
        const resolved = typeof next === 'function' ? next([]) : next
        const thread: AssistantThread = {
          id,
          title: assistantThreadTitle(resolved),
          createdAt: now,
          updatedAt: now,
          messages: resolved,
        }
        const updated = [thread, ...threadsRef.current]
        setThreads(updated)
        threadsRef.current = updated
        syncActiveThread(id)
        setMessages(resolved)
        saveAssistantThreads(userId, { threads: updated, activeThreadId: id })
        return id
      }
      const prev = threadsRef.current.find(t => t.id === targetId)?.messages ?? []
      const resolved = typeof next === 'function' ? next(prev) : next
      const updated = threadsRef.current.map(t =>
        t.id === targetId ? { ...t, messages: resolved, updatedAt: now } : t,
      )
      setThreads(updated)
      threadsRef.current = updated
      if (activeThreadIdRef.current === targetId) setMessages(resolved)
      saveAssistantThreads(userId, { threads: updated, activeThreadId: activeThreadIdRef.current })
      return targetId
    },
    [userId, syncActiveThread],
  )

  const switchThread = useCallback(
    (id: string) => {
      if (!userId || id === activeThreadIdRef.current) return
      const thread = threadsRef.current.find(t => t.id === id)
      if (!thread) return
      syncActiveThread(id)
      setMessages(thread.messages)
      setPendingConfirmations([])
      setPendingClientActions([])
      saveAssistantThreads(userId, { threads: threadsRef.current, activeThreadId: id })
    },
    [userId, syncActiveThread],
  )

  const startNewThread = useCallback(() => {
    if (!userId) return
    const id = createAssistantThreadId()
    const now = Date.now()
    const thread: AssistantThread = { id, title: '', createdAt: now, updatedAt: now, messages: [] }
    const updated = [thread, ...threadsRef.current].slice(0, MAX_THREADS)
    setThreads(updated)
    threadsRef.current = updated
    syncActiveThread(id)
    setMessages([])
    setPendingConfirmations([])
    setPendingClientActions([])
    saveAssistantThreads(userId, { threads: updated, activeThreadId: id })
  }, [userId, syncActiveThread])

  const deleteThread = useCallback(
    (id: string) => {
      if (!userId) return
      const updated = threadsRef.current.filter(t => t.id !== id)
      setThreads(updated)
      threadsRef.current = updated
      if (activeThreadIdRef.current === id) {
        const next = updated[0]?.id ?? null
        syncActiveThread(next)
        setMessages(updated[0]?.messages ?? [])
        setPendingConfirmations([])
        setPendingClientActions([])
      }
      saveAssistantThreads(userId, { threads: updated, activeThreadId: activeThreadIdRef.current })
    },
    [userId, syncActiveThread],
  )

  const getActiveThreadId = useCallback(() => activeThreadIdRef.current, [])

  const value = useMemo(
    () => ({
      open,
      openAssistant,
      closeAssistant,
      messages,
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
      threads,
      activeThreadId,
      getActiveThreadId,
      switchThread,
      startNewThread,
      deleteThread,
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
      threads,
      activeThreadId,
      getActiveThreadId,
      switchThread,
      startNewThread,
      deleteThread,
    ],
  )

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}
