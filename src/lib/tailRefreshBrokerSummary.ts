import { metatraderApi } from './metatraderapi'
import { formatLocalCalendarDay } from './dayStartBalance'
import {
  resolveLinkedAccountType,
  resolveMtServerCandidate,
  type LinkedAccountType,
} from './brokerFromServer'
import type { BrokerAccount } from '../types/database'

export async function tailRefreshBrokerSummary(
  brokerId: string,
  brokers: BrokerAccount[],
  onUpdate: (patch: Partial<BrokerAccount>, accountType?: LinkedAccountType) => void,
): Promise<void> {
  const delays = [1500, 2500, 4000, 6000, 8000]
  for (const delay of delays) {
    await new Promise(resolve => setTimeout(resolve, delay))
    try {
      const { summary, performance_baseline_balance } = await metatraderApi.summary(brokerId, {
        calendarDay: formatLocalCalendarDay(),
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      })
      if (summary && (summary.balance != null || summary.equity != null || summary.currency)) {
        const patch: Partial<BrokerAccount> = {
          last_balance: summary.balance ?? null,
          last_equity: summary.equity ?? null,
          last_currency: summary.currency ?? null,
          last_synced_at: new Date().toISOString(),
          connection_status: 'connected',
          ...(performance_baseline_balance != null && Number.isFinite(Number(performance_baseline_balance))
            ? { performance_baseline_balance: Number(performance_baseline_balance) }
            : {}),
        }
        const match = brokers.find(b => b.id === brokerId)
        const accountType = resolveLinkedAccountType(
          summary.type,
          match ? resolveMtServerCandidate(match, match.broker_server) : null,
        )
        onUpdate(patch, accountType)
        return
      }
    } catch {
      // Keep trying — the MT server may still be authenticating.
    }
  }
}
