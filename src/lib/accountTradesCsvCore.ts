import { isTradeableMtRow } from './dashboardTradeStats'
import { isMtTimestampInRange } from './mtApiDateTime'
import type { MtTrade } from './fxsocketBroker'

export type AccountTradesCsvExportArgs = {
  /** `today` or `YYYY-MM-DD` (local calendar). Default today. */
  day?: string
  broker_account_id?: string | null
  account_login?: string | null
  label?: string | null
}

export type AccountTradesCsvExportResult = {
  filename: string
  day: string
  count: number
  csv: string
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar YYYY-MM-DD for `today` or validate an explicit day string. */
export function resolveExportDayKey(dayRaw: string | undefined, ref = new Date()): string {
  const raw = String(dayRaw ?? 'today').trim().toLowerCase() || 'today'
  if (raw === 'today') {
    return `${ref.getFullYear()}-${pad2(ref.getMonth() + 1)}-${pad2(ref.getDate())}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return `${ref.getFullYear()}-${pad2(ref.getMonth() + 1)}-${pad2(ref.getDate())}`
}

/** Local midnight bounds for a YYYY-MM-DD day key. */
export function dayBoundsForKey(dayKey: string): { start: Date; end: Date } {
  const [y, m, d] = dayKey.split('-').map(Number)
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

/** Trades opened on the local calendar day (same rule as dashboard “trades today”). */
export function filterMtTradesForExportDay(
  trades: readonly MtTrade[],
  dayKey: string,
  brokerAccountId?: string | null,
): MtTrade[] {
  const { start, end } = dayBoundsForKey(dayKey)
  const brokerId = brokerAccountId?.trim() || ''
  return trades.filter(t => {
    if (brokerId && t.broker_id !== brokerId) return false
    if (!isTradeableMtRow(t)) return false
    return isMtTimestampInRange(t.opened_at, start, end)
  })
}

export function buildAccountTradesCsv(trades: readonly MtTrade[]): string {
  const header = [
    'Ticket',
    'Broker',
    'Symbol',
    'Direction',
    'Lots',
    'Entry',
    'SL',
    'TP',
    'Close',
    'Profit',
    'Swap',
    'Commission',
    'Opened',
    'Closed',
    'Status',
    'Comment',
  ]

  const rows = [...trades]
    .sort((a, b) => {
      const ta = a.opened_at ? new Date(a.opened_at).getTime() : 0
      const tb = b.opened_at ? new Date(b.opened_at).getTime() : 0
      return tb - ta
    })
    .map(t =>
      [
        t.ticket || '',
        t.broker_label || t.broker_name || '',
        t.symbol,
        t.direction || t.type || '',
        t.lot_size,
        t.entry_price,
        t.sl,
        t.tp,
        t.close_price,
        t.profit,
        t.swap,
        t.commission,
        t.opened_at,
        t.closed_at,
        t.status,
        t.comment,
      ]
        .map(csvEscape)
        .join(','),
    )

  return `\uFEFF${[header.join(','), ...rows].join('\n')}\n`
}

export function downloadCsvText(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
