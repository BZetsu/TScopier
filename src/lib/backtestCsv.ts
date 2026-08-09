import type { BacktestTradeRow } from './backtestTypes'
import {
  displayOutcomeLabel,
  formatDurationMs,
  formatEntryPrice,
  formatSignalTimestamp,
  tradeDurationMs,
  tradePipPnl,
} from './backtestDisplay'

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Build a CSV string for backtest trade rows (UTF-8, Excel-friendly). */
export function buildBacktestResultsCsv(trades: BacktestTradeRow[]): string {
  const header = [
    'Time',
    'Symbol',
    'Side',
    'Entry',
    'SL',
    'TP Levels',
    'Outcome',
    'TPs Hit',
    'Pips',
    'Duration',
    'Closed At',
  ]

  const rows = [...trades]
    .sort((a, b) => new Date(b.signal_at).getTime() - new Date(a.signal_at).getTime())
    .map((trade) => {
      const pips = tradePipPnl(trade)
      const durationMs = tradeDurationMs(trade.signal_at, trade.closed_at)
      const tpLevels = Array.isArray(trade.tp_levels) ? trade.tp_levels : []
      return [
        formatSignalTimestamp(trade.signal_at),
        trade.symbol,
        trade.direction === 'buy' ? 'Buy' : 'Sell',
        formatEntryPrice(trade.entry_price),
        trade.sl != null ? formatEntryPrice(trade.sl) : '',
        tpLevels.map((p) => formatEntryPrice(p)).join(' | '),
        displayOutcomeLabel(trade.outcome, trade.tps_hit, tpLevels.length),
        trade.tps_hit,
        pips != null && Number.isFinite(pips) ? pips.toFixed(2) : '',
        formatDurationMs(durationMs) === '—' ? '' : formatDurationMs(durationMs),
        trade.closed_at ? formatSignalTimestamp(trade.closed_at) : '',
      ].map(csvEscape).join(',')
    })

  // BOM helps Excel detect UTF-8
  return `\uFEFF${[header.join(','), ...rows].join('\n')}\n`
}

export function downloadBacktestResultsCsv(
  trades: BacktestTradeRow[],
  opts?: { filename?: string },
): void {
  const csv = buildBacktestResultsCsv(trades)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = opts?.filename ?? `backtest-results-${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
