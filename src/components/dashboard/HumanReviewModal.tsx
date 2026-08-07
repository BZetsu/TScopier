import { useState } from 'react'
import { X } from 'lucide-react'
import { useHumanReview } from '../../context/HumanReviewContext'
import { HUMAN_REVIEW_WINDOW_MS } from '../../lib/humanReview'

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired'
  const totalSec = Math.ceil(ms / 1000)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return min > 0 ? `${min}m ${sec}s left` : `${sec}s left`
}

export function HumanReviewModal() {
  const { pending, isOpen, closeModal, approve, dismiss } = useHumanReview()
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [errorBySignal, setErrorBySignal] = useState<Record<string, string>>({})

  if (!isOpen) return null

  const handleApprove = async (signalId: string) => {
    setApprovingId(signalId)
    setErrorBySignal(prev => ({ ...prev, [signalId]: '' }))
    const error = await approve(signalId)
    setApprovingId(null)
    if (error) setErrorBySignal(prev => ({ ...prev, [signalId]: error }))
  }

  const handleDismiss = (signalId: string) => {
    setErrorBySignal(prev => {
      const next = { ...prev }
      delete next[signalId]
      return next
    })
    dismiss(signalId)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div
        className="absolute inset-0 bg-neutral-950/55"
        aria-hidden
        onClick={closeModal}
      />
      <div className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl dark:bg-neutral-900">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
          <h2 className="flex-1 text-base font-semibold text-neutral-900 dark:text-neutral-50">
            Signal review required
          </h2>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {pending.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No signals waiting for review.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {pending.map(item => {
                const { signal, levels } = item
                const expired = item.remainingMs <= 0
                const error = errorBySignal[signal.id]
                return (
                  <li key={signal.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-neutral-900 dark:text-neutral-50">
                          {signal.raw_message}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          {levels.symbol ? (
                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                              {levels.symbol}
                            </span>
                          ) : null}
                          {levels.action ? (
                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-medium uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                              {levels.action}
                            </span>
                          ) : null}
                          {levels.entry ? (
                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              Entry {levels.entry}
                            </span>
                          ) : null}
                          {levels.sl ? (
                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              SL {levels.sl}
                            </span>
                          ) : null}
                          {levels.tp ? (
                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              TP {levels.tp}
                            </span>
                          ) : null}
                        </div>
                        <p className={`mt-2 text-xs ${expired ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-400 dark:text-neutral-500'}`}>
                          {expired ? 'expired — approval window passed' : formatRemaining(item.remainingMs)}
                        </p>
                        {error ? (
                          <p className="mt-2 break-words text-xs text-red-600 dark:text-red-400">
                            {error}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={approvingId === signal.id || expired}
                          onClick={() => { void handleApprove(signal.id) }}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {approvingId === signal.id ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={approvingId === signal.id}
                          onClick={() => handleDismiss(signal.id)}
                          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          Approvals are valid for {Math.round(HUMAN_REVIEW_WINDOW_MS / 60000)} minutes after the signal
          and only while the market is still at the signal entry price.
        </div>
      </div>
    </div>
  )
}
