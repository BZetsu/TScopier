/** UTC bounds for backtest_channel_signals queries (matches worker sync range). */
export function backtestDateRangeIso(
  dateFrom: string,
  dateTo: string,
): { fromIso: string; toIso: string } {
  const from = dateFrom.trim()
  const to = dateTo.trim()
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from)
    ? `${from}T00:00:00.000Z`
    : new Date(from).toISOString()
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to)
    ? `${to}T23:59:59.999Z`
    : new Date(to).toISOString()
  return { fromIso, toIso }
}
