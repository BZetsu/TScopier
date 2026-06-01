import type { SubscriptionPlan } from '../../lib/planLimits'

type TradeStyleCarrier = {
  manualSettings?: {
    trade_style?: string | null
  } | null
}

export function hasRequestedMultiTradeStyle(
  channelIds: string[],
  channelConfigs: Record<string, TradeStyleCarrier | undefined>,
): boolean {
  return channelIds.some(
    id => (channelConfigs[id]?.manualSettings?.trade_style ?? 'single') === 'multi',
  )
}

export function shouldBlockMultiTradeSave(args: {
  requestedMulti: boolean
  effectivePlan: SubscriptionPlan | null
}): boolean {
  return args.requestedMulti && args.effectivePlan !== 'advanced'
}

export function choosePersistedSelectedChannelId(args: {
  preferredSelectedId: string | null
  persistedChannelIds: string[]
  fallbackSelectedId: string | null
}): string | null {
  if (args.preferredSelectedId && args.persistedChannelIds.includes(args.preferredSelectedId)) {
    return args.preferredSelectedId
  }
  return args.fallbackSelectedId
}
