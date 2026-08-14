import { supabase } from './supabase'

export type LayeringModeCapabilityReason =
  | 'global_disabled'
  | 'kill_switch_active'
  | 'mode_disabled'
  | 'account_not_allowlisted'
  | 'prepare_only'
  | 'broker_disconnected'
  | 'broker_pending_unsupported'
  | 'advanced_plan_required'
  | 'capability_unavailable'
  | string

export interface LayeringModeCapability {
  available: boolean
  configurable?: boolean
  preparationAvailable?: boolean
  executionAvailable?: boolean
  reasons: LayeringModeCapabilityReason[]
  executionMechanisms?: {
    auto: boolean | { configurable?: boolean; executable?: boolean }
    pending_order: boolean | { configurable?: boolean; executable?: boolean }
  }
}

export interface LayeringModeCapabilities {
  layeringModes: {
    legacy: { available: true }
    static: LayeringModeCapability
    dynamic: LayeringModeCapability
  }
  limits: {
    staticLayerCount: { min: number; max: number }
    dynamicStepPips: { minExclusive: number }
    dynamicMaxLayers: { min: number; max: number }
  }
  rollout: { prepareOnly: boolean }
}

export const LEGACY_ONLY_LAYERING_CAPABILITIES: LayeringModeCapabilities = {
  layeringModes: {
    legacy: { available: true },
    static: {
      available: false,
      reasons: ['capability_unavailable'],
      configurable: false,
      preparationAvailable: false,
      executionAvailable: false,
      executionMechanisms: {
        auto: { configurable: false, executable: false },
        pending_order: { configurable: false, executable: false },
      },
    },
    dynamic: {
      available: false,
      reasons: ['capability_unavailable'],
      configurable: false,
      preparationAvailable: false,
      executionAvailable: false,
      executionMechanisms: {
        auto: { configurable: false, executable: false },
        pending_order: { configurable: false, executable: false },
      },
    },
  },
  limits: {
    staticLayerCount: { min: 1, max: 20 },
    dynamicStepPips: { minExclusive: 0 },
    dynamicMaxLayers: { min: 1, max: 20 },
  },
  rollout: { prepareOnly: true },
}

function reasons(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function modeCapability(value: unknown): LayeringModeCapability {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const mechanisms = row.executionMechanisms && typeof row.executionMechanisms === 'object'
    ? row.executionMechanisms as Record<string, unknown>
    : {}
  const normalizeMechanism = (value: unknown): { configurable: boolean; executable: boolean } => {
    if (value === true || value === false) return { configurable: value === true, executable: value === true }
    const rec = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return { configurable: rec.configurable === true, executable: rec.executable === true }
  }
  const configurable = row.configurable === true || row.available === true
  const executionAvailable = row.executionAvailable === true
  return {
    available: configurable,
    configurable,
    preparationAvailable: row.preparationAvailable === true || configurable,
    executionAvailable,
    reasons: reasons(row.reasons),
    executionMechanisms: {
      auto: normalizeMechanism(mechanisms.auto),
      pending_order: normalizeMechanism(mechanisms.pending_order),
    },
  }
}

export function normalizeLayeringModeCapabilities(raw: unknown): LayeringModeCapabilities {
  const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const modes = root.layeringModes && typeof root.layeringModes === 'object'
    ? root.layeringModes as Record<string, unknown>
    : {}
  const limits = root.limits && typeof root.limits === 'object'
    ? root.limits as Record<string, unknown>
    : {}
  const staticLimit = limits.staticLayerCount && typeof limits.staticLayerCount === 'object'
    ? limits.staticLayerCount as Record<string, unknown>
    : {}
  const dynStep = limits.dynamicStepPips && typeof limits.dynamicStepPips === 'object'
    ? limits.dynamicStepPips as Record<string, unknown>
    : {}
  const dynMax = limits.dynamicMaxLayers && typeof limits.dynamicMaxLayers === 'object'
    ? limits.dynamicMaxLayers as Record<string, unknown>
    : {}
  const rollout = root.rollout && typeof root.rollout === 'object'
    ? root.rollout as Record<string, unknown>
    : {}
  return {
    layeringModes: {
      legacy: { available: true },
      static: modeCapability(modes.static),
      dynamic: modeCapability(modes.dynamic),
    },
    limits: {
      staticLayerCount: {
        min: Number(staticLimit.min) === 1 ? 1 : 1,
        max: Number(staticLimit.max) === 20 ? 20 : 20,
      },
      dynamicStepPips: {
        minExclusive: Number(dynStep.minExclusive) === 0 ? 0 : 0,
      },
      dynamicMaxLayers: {
        min: Number(dynMax.min) === 1 ? 1 : 1,
        max: Number(dynMax.max) === 20 ? 20 : 20,
      },
    },
    rollout: { prepareOnly: rollout.prepareOnly !== false },
  }
}

export function layeringModeIsSelectable(capabilities: LayeringModeCapabilities, mode: 'legacy' | 'static' | 'dynamic'): boolean {
  if (mode === 'legacy') return true
  const row = capabilities.layeringModes[mode]
  return row.configurable !== false
}

export function layeringMechanismIsSelectable(
  capabilities: LayeringModeCapabilities,
  mode: 'legacy' | 'static' | 'dynamic',
  mechanism: 'auto' | 'pending_order',
): boolean {
  if (mode === 'legacy') return true
  const row = capabilities.layeringModes[mode]
  if (row.configurable === false) return false
  if (mechanism === 'auto') return true
  const value = row.executionMechanisms?.[mechanism]
  return typeof value === 'object' && value !== null
    ? value.configurable === true
    : value === true
}

export function layeringMechanismIsExecutable(
  capabilities: LayeringModeCapabilities,
  mode: 'legacy' | 'static' | 'dynamic',
  mechanism: 'auto' | 'pending_order',
): boolean {
  if (mode === 'legacy') return true
  const row = capabilities.layeringModes[mode]
  if (!row.executionAvailable) return false
  const value = row.executionMechanisms?.[mechanism]
  return typeof value === 'object' && value !== null
    ? value.executable === true
    : value === true
}

export async function fetchLayeringModeCapabilities(brokerAccountId: string): Promise<LayeringModeCapabilities> {
  const { data, error } = await supabase.functions.invoke('layering-mode-capabilities', {
    body: { broker_account_id: brokerAccountId },
  })
  if (error) return LEGACY_ONLY_LAYERING_CAPABILITIES
  return normalizeLayeringModeCapabilities(data)
}
