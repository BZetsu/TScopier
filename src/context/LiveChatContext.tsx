import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import {
  LiveChatWidget,
  maximizeLiveChat,
  type LiveChatVisibility,
} from '../components/layout/LiveChatWidget'

type LiveChatContextValue = {
  visibility: LiveChatVisibility
  openLiveChat: () => void
}

const LiveChatContext = createContext<LiveChatContextValue | null>(null)

export function LiveChatProvider({ children }: { children: ReactNode }) {
  const [visibility, setVisibility] = useState<LiveChatVisibility>('hidden')

  const openLiveChat = useCallback(() => {
    setVisibility('maximized')
    maximizeLiveChat()
  }, [])

  return (
    <LiveChatContext.Provider value={{ visibility, openLiveChat }}>
      <LiveChatWidget visibility={visibility} onVisibilityChanged={setVisibility} />
      {children}
    </LiveChatContext.Provider>
  )
}

export function useLiveChat(): LiveChatContextValue {
  const ctx = useContext(LiveChatContext)
  if (!ctx) {
    throw new Error('useLiveChat must be used within LiveChatProvider')
  }
  return ctx
}
