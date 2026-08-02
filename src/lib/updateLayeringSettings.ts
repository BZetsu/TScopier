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

export async function updateLayeringSettings(input: UpdateLayeringSettingsInput): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('update-layering-settings', { body: input })
  return { error: error?.message ?? null }
}
