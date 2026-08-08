import { ensureFreshAuthSession } from './fxsocketBroker'
import { isAssistantImageDataUrl } from './assistantImages'
import { redactTelegramPhones } from './telegramPhone'

export type AssistantChatMessage = {
  role: 'user' | 'assistant'
  content: string
  /** Optional data-URL images (user turns only). Sent as OpenAI vision parts. */
  images?: string[]
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
  }
}

const HISTORY_PREFIX = 'tscopier.assistant.history.'

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
  return images?.length ? { role: m.role, content, images } : { role: m.role, content }
}

/** Keep images only on the newest user turn to stay under sessionStorage quotas. */
function compactHistoryForStorage(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  const sliced = messages.slice(-20)
  let keptImages = false
  const out: AssistantChatMessage[] = []
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i]
    const content = sanitizeMessageContent(m.content)
    if (m.role === 'user' && m.images?.length && !keptImages) {
      out.push({ role: m.role, content, images: m.images })
      keptImages = true
    } else {
      out.push({ role: m.role, content })
    }
  }
  return out.reverse()
}

/** Strip phones from messages before sending to the LLM. */
export function messagesForAssistantApi(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  return messages.map(m => {
    const content = sanitizeMessageContent(m.content)
    return m.images?.length ? { ...m, content } : { role: m.role, content }
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
