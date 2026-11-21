import { selectBrokerAccountColumns } from './brokerAccountSelect'
import {
  buildAccountTradesCsv,
  downloadCsvText,
  filterMtTradesForExportDay,
  resolveExportDayKey,
  type AccountTradesCsvExportArgs,
  type AccountTradesCsvExportResult,
} from './accountTradesCsvCore'
import { getLocalCalendarDayBounds } from './dashboardTradeStats'
import { fetchTradesFromDatabase } from './dbTradesFallback'
import { fetchTradesAcrossProviders, type MtTrade } from './fxsocketBroker'
import { formatBrokerHistoryDate } from './mtApiDateTime'
import { enrichMtTradesTimestamps } from './mtTradeTimestamps'
import { supabase } from './supabase'
import { BROKER_FULL_HISTORY_FROM } from './tradesConstants'
import { filterMtTradesSinceConnect } from './tradesSinceConnect'
import type { BrokerAccount } from '../types/database'

export type { AccountTradesCsvExportArgs, AccountTradesCsvExportResult }
export {
  buildAccountTradesCsv,
  dayBoundsForKey,
  downloadCsvText,
  filterMtTradesForExportDay,
  resolveExportDayKey,
} from './accountTradesCsvCore'

function matchBrokerId(
  accounts: readonly BrokerAccount[],
  args: AccountTradesCsvExportArgs,
): string | null {
  const id = String(args.broker_account_id ?? '').trim()
  if (id) return id
  const login = String(args.account_login ?? '').trim()
  if (login) {
    const hit = accounts.find(a => String(a.account_login ?? '').trim() === login)
    if (hit) return hit.id
  }
  const label = String(args.label ?? '').trim().toLowerCase()
  if (label) {
    const matches = accounts.filter(a => {
      const l = String(a.label ?? '').trim().toLowerCase()
      return l === label || l.includes(label)
    })
    if (matches.length === 1) return matches[0].id
  }
  return null
}

/**
 * Fetch account trades (live MT feed with DB fallback), filter to the day,
 * build CSV, and trigger a browser download.
 */
export async function exportAccountTradesCsv(
  userId: string,
  args: AccountTradesCsvExportArgs = {},
): Promise<AccountTradesCsvExportResult> {
  const dayKey = resolveExportDayKey(args.day)
  const { tomorrowStart: historyTo } = getLocalCalendarDayBounds()

  const brokerRes = await selectBrokerAccountColumns(columns =>
    supabase.from('broker_accounts').select(columns).eq('user_id', userId),
  )
  if (brokerRes.error) throw brokerRes.error
  const accounts = (brokerRes.data ?? []) as unknown as BrokerAccount[]
  const brokerId = matchBrokerId(accounts, args)

  let trades: MtTrade[] = []
  try {
    const tradesRes = await fetchTradesAcrossProviders({
      scope: 'all',
      historyProfile: 'trades',
      historyFrom: BROKER_FULL_HISTORY_FROM,
      historyTo: formatBrokerHistoryDate(historyTo),
      accounts,
      limit: 5000,
    })
    trades = filterMtTradesSinceConnect(enrichMtTradesTimestamps(tradesRes.trades ?? []), accounts)
  } catch {
    trades = await fetchTradesFromDatabase(supabase, userId)
  }

  const filtered = filterMtTradesForExportDay(trades, dayKey, brokerId)
  const csv = buildAccountTradesCsv(filtered)
  const filename = `account-trades-${dayKey}.csv`
  downloadCsvText(csv, filename)
  return { filename, day: dayKey, count: filtered.length, csv }
}
