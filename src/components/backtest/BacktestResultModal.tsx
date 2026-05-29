import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Plus, Scale, Trash2, TrendingUp, X } from 'lucide-react'
import clsx from 'clsx'
import { useT } from '../../context/LocaleContext'
import { backtestApi } from '../../lib/backtestApi'
import type { BacktestRunRow, BacktestTradeRow } from '../../lib/backtestTypes'
import {
  backtestDisplayLabels,
  computeRiskRewardRatio,
  displayOutcomeLabel,
  formatDurationMs,
  formatEntryPrice,
  formatPipValue,
  formatSignalTimestamp,
  outcomeBannerLabel,
  outcomeBannerTone,
  tradeDurationMs,
  tradePipPnl,
} from '../../lib/backtestDisplay'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { BacktestPriceLadder } from './BacktestPriceLadder'
import { BacktestEventTimeline } from './BacktestEventTimeline'

interface TradeDraft {
  direction: 'buy' | 'sell'
  entryPrice: string
  sl: string
  tpLevels: string[]
}

interface BacktestResultModalProps {
  trade: BacktestTradeRow | null
  onClose: () => void
  onTradeUpdated: (trade: BacktestTradeRow, run: BacktestRunRow | null) => void
  onTradeDeleted: (tradeId: string, run: BacktestRunRow | null) => void
}

function tradeToDraft(trade: BacktestTradeRow): TradeDraft {
  return {
    direction: trade.direction === 'sell' ? 'sell' : 'buy',
    entryPrice: trade.entry_price > 0 ? String(trade.entry_price) : '',
    sl: trade.sl != null ? String(trade.sl) : '',
    tpLevels: trade.tp_levels.length > 0
      ? trade.tp_levels.map(String)
      : [''],
  }
}

function parseDraft(draft: TradeDraft): {
  entry_price: number
  sl: number | null
  tp_levels: number[]
} | null {
  const entry_price = Number(draft.entryPrice)
  const sl = draft.sl.trim() === '' ? null : Number(draft.sl)
  const tp_levels = draft.tpLevels
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0)

  if (!(entry_price > 0)) return null
  if (sl !== null && !(sl > 0)) return null
  if (sl === null && tp_levels.length === 0) return null
  return { entry_price, sl, tp_levels }
}

function draftPreviewTrade(base: BacktestTradeRow, draft: TradeDraft): BacktestTradeRow {
  const parsed = parseDraft(draft)
  if (!parsed) {
    return { ...base, direction: draft.direction }
  }
  return {
    ...base,
    direction: draft.direction,
    entry_price: parsed.entry_price,
    sl: parsed.sl,
    tp_levels: parsed.tp_levels,
  }
}

export function BacktestResultModal({
  trade,
  onClose,
  onTradeUpdated,
  onTradeDeleted,
}: BacktestResultModalProps) {
  const t = useT()
  const bt = t.backtest
  const btLabels = backtestDisplayLabels(bt)
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<TradeDraft | null>(null)
  const [displayTrade, setDisplayTrade] = useState<BacktestTradeRow | null>(null)
  const [busy, setBusy] = useState<'rerun' | 'delete' | null>(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!trade) {
      setDraft(null)
      setDisplayTrade(null)
      setFormError('')
      return
    }
    setDraft(tradeToDraft(trade))
    setDisplayTrade(trade)
    setFormError('')
  }, [trade])

  useEffect(() => {
    if (!trade) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [trade, onClose, busy])

  const previewTrade = useMemo(() => {
    if (!displayTrade || !draft) return displayTrade
    return draftPreviewTrade(displayTrade, draft)
  }, [displayTrade, draft])

  if (!trade || !draft || !previewTrade) return null

  const pips = tradePipPnl(previewTrade)
  const durationMs = tradeDurationMs(previewTrade.signal_at, previewTrade.closed_at)
  const rr = computeRiskRewardRatio(
    previewTrade.entry_price,
    previewTrade.sl,
    previewTrade.tp_levels,
    previewTrade.direction,
  )
  const banner = outcomeBannerLabel(
    previewTrade.outcome,
    previewTrade.tps_hit,
    previewTrade.tp_levels.length,
    btLabels,
  )
  const bannerTone = outcomeBannerTone(previewTrade.outcome, pips)
  const outcomeLabel = displayOutcomeLabel(
    previewTrade.outcome,
    previewTrade.tps_hit,
    previewTrade.tp_levels.length,
    btLabels.outcomes,
  )
  const pipsPositive = pips != null && pips > 0
  const pipsNegative = pips != null && pips < 0
  const isDirty =
    draft.direction !== (trade.direction === 'sell' ? 'sell' : 'buy')
    || draft.entryPrice !== (trade.entry_price > 0 ? String(trade.entry_price) : '')
    || draft.sl !== (trade.sl != null ? String(trade.sl) : '')
    || JSON.stringify(draft.tpLevels.filter(Boolean)) !== JSON.stringify(trade.tp_levels.map(String))

  const bannerClass =
    bannerTone === 'success'
      ? 'bg-teal-50 border-teal-200 text-teal-800 dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-200'
      : bannerTone === 'danger'
        ? 'bg-error-50 border-error-200 text-error-800 dark:bg-error-950/40 dark:border-error-800 dark:text-error-200'
        : bannerTone === 'warning'
          ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
          : 'bg-neutral-50 border-neutral-200 text-neutral-700 dark:bg-neutral-800/50 dark:border-neutral-700'

  const handleRerun = async () => {
    const parsed = parseDraft(draft)
    if (!parsed) {
      setFormError(bt.invalidLevels)
      return
    }
    setFormError('')
    setBusy('rerun')
    try {
      const { trade: updated, run } = await backtestApi.resimulateTrade({
        trade_id: trade.id,
        direction: draft.direction,
        ...parsed,
      })
      setDisplayTrade(updated)
      setDraft(tradeToDraft(updated))
      onTradeUpdated(updated, run)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : bt.rerunFailed)
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(bt.deleteConfirm)) return
    setFormError('')
    setBusy('delete')
    try {
      const { run } = await backtestApi.deleteTrade(trade.id)
      onTradeDeleted(trade.id, run)
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : bt.deleteFailed)
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backtest-result-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm"
        aria-label={bt.close}
        onClick={onClose}
        disabled={Boolean(busy)}
      />
      <div
        ref={panelRef}
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur">
          <h2 id="backtest-result-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {bt.resultModalTitle}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={Boolean(busy)}
              className="p-2 rounded-lg text-neutral-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-950/40 transition-colors disabled:opacity-40"
              aria-label={bt.deleteResult}
              onClick={() => { void handleDelete() }}
            >
              {busy === 'delete' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Trash2 className="w-5 h-5" />
              )}
            </button>
            <button
              type="button"
              className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
              aria-label={bt.close}
              onClick={onClose}
              disabled={Boolean(busy)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3 bg-neutral-50/50 dark:bg-neutral-800/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{bt.editSignal}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2 sm:col-span-1">
                <span className="text-xs font-medium text-neutral-500">{bt.direction}</span>
                <select
                  value={draft.direction}
                  disabled={Boolean(busy)}
                  onChange={e => setDraft(d => d && ({
                    ...d,
                    direction: e.target.value === 'sell' ? 'sell' : 'buy',
                  }))}
                  className="mt-1.5 w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 text-sm disabled:opacity-50"
                >
                  <option value="buy">{bt.buy}</option>
                  <option value="sell">{bt.sell}</option>
                </select>
              </label>
              <Input
                label={bt.entry}
                type="number"
                step="any"
                min="0"
                disabled={Boolean(busy)}
                value={draft.entryPrice}
                onChange={e => setDraft(d => d && ({ ...d, entryPrice: e.target.value }))}
              />
              <Input
                label={bt.stopLoss}
                type="number"
                step="any"
                min="0"
                disabled={Boolean(busy)}
                placeholder="—"
                value={draft.sl}
                onChange={e => setDraft(d => d && ({ ...d, sl: e.target.value }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-neutral-500">{bt.takeProfits}</span>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setDraft(d => d && ({ ...d, tpLevels: [...d.tpLevels, ''] }))}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {bt.addTp}
                </button>
              </div>
              <div className="space-y-2">
                {draft.tpLevels.map((tp, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={Boolean(busy)}
                      placeholder={`TP${idx + 1}`}
                      value={tp}
                      onChange={e => setDraft(d => {
                        if (!d) return d
                        const next = [...d.tpLevels]
                        next[idx] = e.target.value
                        return { ...d, tpLevels: next }
                      })}
                      className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm disabled:opacity-50"
                    />
                    {draft.tpLevels.length > 1 ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        aria-label={bt.removeTp}
                        onClick={() => setDraft(d => {
                          if (!d) return d
                          const next = d.tpLevels.filter((_, i) => i !== idx)
                          return { ...d, tpLevels: next.length ? next : [''] }
                        })}
                        className="shrink-0 rounded-xl border border-neutral-200 dark:border-neutral-700 px-3 text-neutral-400 hover:text-error-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            {formError ? (
              <p className="text-xs text-error-600 dark:text-error-400">{formError}</p>
            ) : null}
            <Button
              className="w-full"
              disabled={Boolean(busy)}
              onClick={() => { void handleRerun() }}
            >
              {busy === 'rerun' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {bt.rerunning}
                </>
              ) : (
                bt.rerunCheck
              )}
            </Button>
            {isDirty && !busy ? (
              <p className="text-[11px] text-neutral-500 text-center">{bt.unsavedHint}</p>
            ) : null}
          </div>

          <div className={clsx('flex items-center gap-2.5 rounded-xl border px-4 py-3', bannerClass)}>
            {bannerTone === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <TrendingUp className="w-5 h-5 shrink-0 opacity-70" />
            )}
            <span className="font-semibold">{banner}</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{bt.pips}</p>
              <p
                className={clsx(
                  'text-xl font-bold tabular-nums mt-1',
                  pipsPositive && 'text-teal-600 dark:text-teal-400',
                  pipsNegative && 'text-error-600 dark:text-error-400',
                  !pipsPositive && !pipsNegative && 'text-neutral-900 dark:text-neutral-50',
                )}
              >
                {formatPipValue(pips).replace(/p$/, '')}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 flex items-center justify-center gap-1">
                <Scale className="w-3 h-3" />
                {bt.riskReward}
              </p>
              <p className="text-xl font-bold tabular-nums mt-1 text-neutral-900 dark:text-neutral-50">
                {rr}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" />
                {bt.duration}
              </p>
              <p className="text-xl font-bold tabular-nums mt-1 text-neutral-900 dark:text-neutral-50">
                {formatDurationMs(durationMs)}
              </p>
            </div>
          </div>

          <div className="text-xs text-neutral-500 flex flex-wrap gap-x-3 gap-y-1">
            <span>{previewTrade.symbol}</span>
            <span>·</span>
            <span className="uppercase font-medium">{previewTrade.direction}</span>
            <span>·</span>
            <span>{outcomeLabel}</span>
            <span>·</span>
            <span className="tabular-nums">@ {formatEntryPrice(previewTrade.entry_price)}</span>
            <span>·</span>
            <span className="tabular-nums">{formatSignalTimestamp(previewTrade.signal_at)}</span>
          </div>

          <BacktestPriceLadder trade={previewTrade} labels={btLabels} />
          <BacktestEventTimeline trade={previewTrade} labels={btLabels} />
        </div>
      </div>
    </div>
  )
}
