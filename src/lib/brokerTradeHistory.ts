import {
  DASHBOARD_CHART_MT_HISTORY_DAYS,
  PERFORMANCE_MT_HISTORY_DAYS,
} from './dashboardCharts'
import { getLocalCalendarDayBounds } from './dashboardTradeStats'
import { fxsocketBroker, type MtTrade } from './fxsocketBroker'
import { formatLocalMtApiDateTime } from './mtApiDateTime'

export type BrokerMtHistoryScope = 'dashboard' | 'performance'

const DEFAULT_HISTORY_DAYS: Record<BrokerMtHistoryScope, number> = {
  dashboard: DASHBOARD_CHART_MT_HISTORY_DAYS,
  performance: PERFORMANCE_MT_HISTORY_DAYS,
}

/** Pull open positions + closed deal history from linked FxSocket brokers (edge `trades` action). */
export async function fetchBrokerMtTrades(opts: {
  scope?: BrokerMtHistoryScope
  brokerId?: string
  historyProfile?: 'dashboard' | 'trades'
  historyDays?: number
  limit?: number
} = {}): Promise<MtTrade[]> {
  const historyDays = opts.historyDays ?? DEFAULT_HISTORY_DAYS[opts.scope ?? 'dashboard']
  const { tomorrowStart: historyTo } = getLocalCalendarDayBounds()
  const historyFrom = new Date()
  historyFrom.setDate(historyFrom.getDate() - historyDays)

  const res = await fxsocketBroker.trades({
    brokerId: opts.brokerId,
    scope: 'all',
    historyProfile: opts.historyProfile ?? 'trades',
    historyFrom: formatLocalMtApiDateTime(historyFrom),
    historyTo: formatLocalMtApiDateTime(historyTo),
    ...(opts.limit != null && opts.limit > 0 ? { limit: opts.limit } : {}),
  })
  return res.trades ?? []
}
