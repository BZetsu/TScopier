import { supabase } from './supabase'

export interface UpdateLayeringSettingsInput {
  broker_account_id: string
  channel_id?: string | null
  layering_mode: 'legacy' | 'static' | 'dynamic'
  range_layering_type: 'auto' | 'pending_order'
  static_layer_count: number
  dynamic_step_pips: number
  dynamic_max_layers: number
  layering_optimization_strategy: 'adjust_percent' | 'reduce_layers' | 'widen_step'
}

function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const err = (body as { error?: unknown }).error
  if (typeof err === 'string' && err.trim()) return err.trim()
  const msg = (body as { message?: unknown }).message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  return null
}

/** Prefer the edge function JSON body over Supabase's generic non-2xx message. */
async function invokeErrorMessage(
  error: { message?: string; context?: Response } | null,
  data: unknown,
): Promise<string | null> {
  if (!error) return null
  const fromData = messageFromBody(data)
  if (fromData) return fromData
  try {
    const ctx = error.context
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json()
      const fromCtx = messageFromBody(body)
      if (fromCtx) return fromCtx
    }
  } catch {
    /* body already consumed or not JSON */
  }
  return error.message?.trim() || 'Failed to update layering settings'
}

export async function updateLayeringSettings(input: UpdateLayeringSettingsInput): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('update-layering-settings', { body: input })
  return { error: await invokeErrorMessage(error, data) }
}
