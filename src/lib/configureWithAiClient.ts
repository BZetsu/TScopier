import { ensureFreshAuthSession } from './fxsocketBroker'

export type ConfigureWithAiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ConfigureWithAiSignalExample = {
  raw_message: string
  label?: string
  intent?: Record<string, unknown>
}

export type ConfigureWithAiContext = {
  broker_account_id: string
  channel_id: string
  channel_name?: string
  /** telegram | discord | whatsapp | tradingview */
  source_kind?: string | null
  manual_settings: Record<string, unknown>
  plan_features?: Record<string, boolean>
  plan_limits?: { max_tp_rows?: number | null }
  /** Current Apply-card proposal so follow-ups (e.g. TPs) can revise it. */
  pending_settings_patch?: PendingSettingsPatch | null
  signal_examples?: ConfigureWithAiSignalExample[]
  broker?: {
    balance?: number | null
    equity?: number | null
    currency?: string | null
    label?: string | null
  }
}

export type PendingSettingsPatch = {
  settings: Record<string, unknown>
  summary: string
  rationale: string
  warnings: string[]
}

export type ConfigureWithAiChatAction = {
  id: string
  label: string
}

export type ConfigureWithAiResponse = {
  assistant_message: string
  pending_settings_patch: PendingSettingsPatch | null
  chat_actions?: ConfigureWithAiChatAction[]
  error?: string
}

export async function postConfigureWithAi(params: {
  messages: ConfigureWithAiChatMessage[]
  locale?: string
  context: ConfigureWithAiContext
}): Promise<ConfigureWithAiResponse> {
  const token = await ensureFreshAuthSession()
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/configure-with-ai`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content.slice(0, 8000),
      })),
      locale: params.locale,
      context: params.context,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as ConfigureWithAiResponse & {
    pending_settings_patch?: PendingSettingsPatch | null
  }
  if (!res.ok) {
    throw new Error(data.error || `Configure with AI failed (${res.status})`)
  }
  return {
    assistant_message: data.assistant_message ?? '',
    pending_settings_patch: data.pending_settings_patch ?? null,
    chat_actions: Array.isArray(data.chat_actions) ? data.chat_actions : [],
    error: data.error,
  }
}
