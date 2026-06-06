import type { BrokerAccount } from '../types/database'
import {
  inferBrokerLabelFromServer,
  resolveAccountLogin,
  resolveLinkedAccountType,
  resolveMtServerCandidate,
} from './brokerFromServer'
import { isBrokerSessionConnected } from './brokerReconnect'
import type { LinkedAccountPerformance } from './dashboardTradeStats'

export type LinkedAccountSortKey =
  | 'account'
  | 'broker'
  | 'accountType'
  | 'balance'
  | 'pnl'
  | 'openPnl'
  | 'winRate'
  | 'dd'
  | 'status'

export type SortDirection = 'asc' | 'desc'

export type BrokerBalanceSnapshot = {
  balance?: number
  equity?: number
  broker?: string
  mt_server_hint?: string
  account_type?: 'Live' | 'Demo'
  open_pnl?: number
}

export interface LinkedAccountSortContext {
  balances: Record<string, BrokerBalanceSnapshot>
  performance: Record<string, LinkedAccountPerformance>
  closedProfitByAccountId: Record<string, number>
  hasMtTradeHistory: boolean
}

function compareText(a: string, b: string, dir: 1 | -1): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return cmp !== 0 ? cmp * dir : 0
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1,
): number {
  const na = a != null && Number.isFinite(a) ? a : null
  const nb = b != null && Number.isFinite(b) ? b : null
  if (na == null && nb == null) return 0
  if (na == null) return 1
  if (nb == null) return -1
  if (na === nb) return 0
  return na > nb ? dir : -dir
}

function brokerLabel(
  account: BrokerAccount,
  summary: BrokerBalanceSnapshot | undefined,
): string {
  const apiRaw = (summary?.broker ?? '').trim()
  const fromApi = inferBrokerLabelFromServer(apiRaw) || apiRaw
  const server = resolveMtServerCandidate(account, summary?.mt_server_hint)
  const fromServer = inferBrokerLabelFromServer(server) || (server?.trim() ?? '')
  return (fromApi || fromServer || '—').toLowerCase()
}

function accountLabel(account: BrokerAccount): string {
  const label = (account.label ?? '').trim()
  if (label) return label.toLowerCase()
  const login = resolveAccountLogin(account)
  if (login) return login.toLowerCase()
  return account.id.toLowerCase()
}

function accountTypeRank(
  account: BrokerAccount,
  summary: BrokerBalanceSnapshot | undefined,
): number {
  const type =
    summary?.account_type
    ?? resolveLinkedAccountType(undefined, resolveMtServerCandidate(account, summary?.mt_server_hint))
  if (type === 'Demo') return 1
  if (type === 'Live') return 2
  return 0
}

function openPnlValue(
  account: BrokerAccount,
  summary: BrokerBalanceSnapshot | undefined,
): number | null {
  const fromSummary = summary?.open_pnl
  if (fromSummary != null && Number.isFinite(fromSummary)) return fromSummary
  if (!isBrokerSessionConnected(account)) return null
  const balance = summary?.balance ?? account.last_balance
  const equity = summary?.equity ?? account.last_equity
  if (balance != null && equity != null && Number.isFinite(balance) && Number.isFinite(equity)) {
    return equity - balance
  }
  return null
}

function balanceValue(
  account: BrokerAccount,
  summary: BrokerBalanceSnapshot | undefined,
): number | null {
  const bal = summary?.balance ?? account.last_balance ?? summary?.equity ?? account.last_equity
  return bal != null && Number.isFinite(Number(bal)) ? Number(bal) : null
}

function closedPnlValue(
  accountId: string,
  ctx: LinkedAccountSortContext,
): number | null {
  if (!ctx.hasMtTradeHistory) return null
  return ctx.closedProfitByAccountId[accountId] ?? 0
}

function statusRank(account: BrokerAccount): number {
  if (!isBrokerSessionConnected(account)) return 0
  if (account.is_active) return 2
  return 1
}

function compareAccounts(
  a: BrokerAccount,
  b: BrokerAccount,
  key: LinkedAccountSortKey,
  dir: SortDirection,
  ctx: LinkedAccountSortContext,
): number {
  const d: 1 | -1 = dir === 'asc' ? 1 : -1
  const summaryA = ctx.balances[a.id]
  const summaryB = ctx.balances[b.id]
  const perfA = ctx.performance[a.id]
  const perfB = ctx.performance[b.id]

  let cmp = 0
  switch (key) {
    case 'account':
      cmp = compareText(accountLabel(a), accountLabel(b), d)
      break
    case 'broker':
      cmp = compareText(brokerLabel(a, summaryA), brokerLabel(b, summaryB), d)
      break
    case 'accountType':
      cmp = compareNullableNumber(accountTypeRank(a, summaryA), accountTypeRank(b, summaryB), d)
      break
    case 'balance':
      cmp = compareNullableNumber(balanceValue(a, summaryA), balanceValue(b, summaryB), d)
      break
    case 'pnl':
      cmp = compareNullableNumber(closedPnlValue(a.id, ctx), closedPnlValue(b.id, ctx), d)
      break
    case 'openPnl':
      cmp = compareNullableNumber(openPnlValue(a, summaryA), openPnlValue(b, summaryB), d)
      break
    case 'winRate':
      cmp = compareNullableNumber(perfA?.winRate ?? null, perfB?.winRate ?? null, d)
      break
    case 'dd':
      cmp = compareNullableNumber(perfA?.maxDrawdownPct ?? null, perfB?.maxDrawdownPct ?? null, d)
      break
    case 'status':
      cmp = compareNullableNumber(statusRank(a), statusRank(b), d)
      break
  }

  if (cmp !== 0) return cmp
  return a.id.localeCompare(b.id)
}

export function sortLinkedAccounts(
  accounts: BrokerAccount[],
  key: LinkedAccountSortKey,
  direction: SortDirection,
  ctx: LinkedAccountSortContext,
): BrokerAccount[] {
  return [...accounts].sort((a, b) => compareAccounts(a, b, key, direction, ctx))
}
