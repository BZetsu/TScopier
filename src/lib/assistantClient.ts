import { ensureFreshAuthSession } from './fxsocketBroker'
import { isAssistantImageDataUrl } from './assistantImages'
import { redactTelegramPhones } from './telegramPhone'

export type AssistantChatMessage = {
  role: 'user' | 'assistant'
  content: string
  /** Optional data-URL images (user turns only). Sent as OpenAI vision parts. */
  images?: string[]
  /** Tool results (trade cards, etc.) produced alongside this assistant turn. */
  tool_results?: Array<{ tool: string; result: string }>
}

export type PendingClientAction = {
  type: string
  summary: string
  args?: Record<string, unknown>
}

export type PendingConfirmation = {
  tool: string
  args: Record<string, unknown>
  summary: string
  /** Structured label/value rows rendered on the confirm card (e.g. report_trade details). */
  details?: Array<{ label: string; value: string }>
}

export type AssistantChatResponse = {
  assistant_message: string
  pending_client_actions: PendingClientAction[]
  pending_confirmations: PendingConfirmation[]
  tool_results?: Array<{ tool: string; result: string }>
  error?: string
}

export async function postAssistantChat(params: {
  messages: AssistantChatMessage[]
  locale?: string
}): Promise<AssistantChatResponse> {
  const token = await ensureFreshAuthSession()
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({
      messages: messagesForAssistantApi(params.messages),
      locale: params.locale,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as AssistantChatResponse
  if (!res.ok) {
    throw new Error(data.error || `Assistant request failed (${res.status})`)
  }
  return {
    assistant_message: data.assistant_message ?? '',
    pending_client_actions: data.pending_client_actions ?? [],
    pending_confirmations: data.pending_confirmations ?? [],
    tool_results: data.tool_results,
  }
}

export async function executeAssistantAction(params: {
  tool: string
  args: Record<string, unknown>
}): Promise<AssistantChatResponse> {
  const token = await ensureFreshAuthSession()
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({
      execute: { tool: params.tool, args: params.args },
    }),
  })
  const data = (await res.json().catch(() => ({}))) as AssistantChatResponse
  if (!res.ok) {
    throw new Error(data.error || `Action failed (${res.status})`)
  }
  return {
    assistant_message: data.assistant_message ?? 'Done.',
    pending_client_actions: data.pending_client_actions ?? [],
    pending_confirmations: data.pending_confirmations ?? [],
    tool_results: data.tool_results,
    error: data.error,
  }
}

const HISTORY_PREFIX = 'tscopier.assistant.history.'
const THREADS_PREFIX = 'tscopier.assistant.threads.'
export const MAX_THREADS = 8
const MAX_MESSAGES_PER_THREAD = 20

function sanitizeMessageContent(content: string): string {
  return redactTelegramPhones(content)
}

function normalizeStoredMessage(m: AssistantChatMessage): AssistantChatMessage | null {
  if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
    return null
  }
  const content = sanitizeMessageContent(m.content)
  const images =
    m.role === 'user' && Array.isArray(m.images)
      ? m.images.filter(isAssistantImageDataUrl).slice(0, 3)
      : undefined
  const tool_results =
    m.role === 'assistant' && Array.isArray(m.tool_results)
      ? m.tool_results.filter(tr => tr && typeof tr.tool === 'string' && typeof tr.result === 'string')
      : undefined
  const base: AssistantChatMessage = { role: m.role, content }
  if (images?.length) base.images = images
  if (tool_results?.length) base.tool_results = tool_results
  return base
}

/** Keep images only on the newest user turn to stay under sessionStorage quotas. */
function compactHistoryForStorage(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  const sliced = messages.slice(-20)
  let keptImages = false
  const out: AssistantChatMessage[] = []
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i]
    const content = sanitizeMessageContent(m.content)
    const tool_results =
      m.role === 'assistant' && m.tool_results?.length
        ? m.tool_results
        : undefined
    if (m.role === 'user' && m.images?.length && !keptImages) {
      out.push({ role: m.role, content, images: m.images })
      keptImages = true
    } else {
      const base: AssistantChatMessage = { role: m.role, content }
      if (tool_results?.length) base.tool_results = tool_results
      out.push(base)
    }
  }
  return out.reverse()
}

/** Strip phones from messages before sending to the LLM. */
export function messagesForAssistantApi(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  return messages.map(m => {
    const content = sanitizeMessageContent(m.content)
    const base: AssistantChatMessage = { role: m.role, content }
    if (m.images?.length) base.images = m.images
    return base
  })
}

export function loadAssistantHistory(userId: string): AssistantChatMessage[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_PREFIX + userId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AssistantChatMessage[]
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeStoredMessage).filter((m): m is AssistantChatMessage => m != null).slice(-20)
  } catch {
    return []
  }
}

export function saveAssistantHistory(userId: string, messages: AssistantChatMessage[]): void {
  try {
    sessionStorage.setItem(
      HISTORY_PREFIX + userId,
      JSON.stringify(compactHistoryForStorage(messages)),
    )
  } catch {
    // ignore quota / private mode
  }
}

export type AssistantThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AssistantChatMessage[]
}

export type AssistantThreadsState = {
  threads: AssistantThread[]
  activeThreadId: string | null
}

export function createAssistantThreadId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function assistantThreadTitle(messages: AssistantChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  return firstUser?.content?.trim().slice(0, 48) ?? ''
}

function normalizeStoredThread(t: AssistantThread): AssistantThread | null {
  if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') return null
  const messages = Array.isArray(t.messages)
    ? t.messages.map(normalizeStoredMessage).filter((m): m is AssistantChatMessage => m != null)
    : []
  return {
    id: t.id,
    title: t.title.slice(0, 64),
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : t.createdAt,
    messages: messages.slice(-MAX_MESSAGES_PER_THREAD),
  }
}

function migrateLegacyHistory(userId: string, state: AssistantThreadsState): AssistantThreadsState {
  const legacy = loadAssistantHistory(userId)
  if (!legacy.length) return state
  const thread: AssistantThread = {
    id: createAssistantThreadId(),
    title: assistantThreadTitle(legacy),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: legacy,
  }
  const next: AssistantThreadsState = { threads: [thread, ...state.threads], activeThreadId: thread.id }
  if (saveAssistantThreads(userId, next)) {
    try {
      sessionStorage.removeItem(HISTORY_PREFIX + userId)
    } catch {
      // ignore
    }
  }
  return next
}

export function loadAssistantThreads(userId: string): AssistantThreadsState {
  try {
    const raw = sessionStorage.getItem(THREADS_PREFIX + userId)
    if (!raw) return migrateLegacyHistory(userId, { threads: [], activeThreadId: null })
    const parsed = JSON.parse(raw) as Partial<AssistantThreadsState>
    if (!Array.isArray(parsed.threads)) return migrateLegacyHistory(userId, { threads: [], activeThreadId: null })
    const threads = parsed.threads
      .map(normalizeStoredThread)
      .filter((t): t is AssistantThread => t != null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS)
    const activeThreadId = threads.some(t => t.id === parsed.activeThreadId)
      ? (parsed.activeThreadId as string)
      : (threads[0]?.id ?? null)
    const state: AssistantThreadsState = { threads, activeThreadId }
    return threads.length ? state : migrateLegacyHistory(userId, state)
  } catch {
    return migrateLegacyHistory(userId, { threads: [], activeThreadId: null })
  }
}

/** Best-effort budget for the per-user sessionStorage entry (safely under the ~5MB quota). */
const THREADS_STORAGE_BUDGET = 4_000_000

function serializeThreads(state: AssistantThreadsState, allowImages: boolean): string {
  return JSON.stringify({
    threads: state.threads
      .map(t => {
        const sliced = t.messages.slice(-MAX_MESSAGES_PER_THREAD)
        let keptImages = false
        const messages: AssistantChatMessage[] = []
        for (let i = sliced.length - 1; i >= 0; i--) {
          const m = sliced[i]
          const base: AssistantChatMessage = { role: m.role, content: m.content }
          if (
            allowImages &&
            m.role === 'user' &&
            m.images?.length &&
            !keptImages
          ) {
            base.images = m.images
            keptImages = true
          }
          if (m.role === 'assistant' && m.tool_results?.length) base.tool_results = m.tool_results
          messages.push(base)
        }
        return { ...t, title: assistantThreadTitle(sliced), messages: messages.reverse() }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS),
    activeThreadId: state.activeThreadId,
  })
}

/** Persist threads for a user. Returns true when the write succeeded. */
export function saveAssistantThreads(userId: string, state: AssistantThreadsState): boolean {
  let serialized = serializeThreads(state, true)
  let allowImages = true
  if (serialized.length > THREADS_STORAGE_BUDGET) {
    serialized = serializeThreads(state, false)
    allowImages = false
  }
  try {
    sessionStorage.setItem(THREADS_PREFIX + userId, serialized)
    return true
  } catch {
    // Quota hit — retry without images, then drop oldest threads until it fits.
    if (allowImages) {
      serialized = serializeThreads(state, false)
      try {
        sessionStorage.setItem(THREADS_PREFIX + userId, serialized)
        return true
      } catch {
        // fall through to dropping threads
      }
    }
    let remaining = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt)
    while (remaining.length > 1) {
      remaining = remaining.slice(0, -1)
      try {
        sessionStorage.setItem(
          THREADS_PREFIX + userId,
          serializeThreads({ threads: remaining, activeThreadId: state.activeThreadId }, false),
        )
        return true
      } catch {
        // keep dropping
      }
    }
    try {
      sessionStorage.setItem(
        THREADS_PREFIX + userId,
        JSON.stringify({ threads: [], activeThreadId: null }),
      )
      return true
    } catch {
      return false
    }
  }
}
