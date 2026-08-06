import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useHumanReview } from '../../context/HumanReviewContext'
import { useReviewActions } from '../../hooks/useReviewActions'
import {
  formatReviewRemaining,
  reviewRemainingMs,
} from '../../lib/humanReview'
import { Card } from '../ui/Card'

/** AI-escalated signals shown in the Trades section as trades awaiting approval. */
export function AwaitingApprovalSection() {
  const { pending, openModal } = useHumanReview()
  const { approvingId, errorBySignal, approve, dismiss } = useReviewActions()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const visible = pending.filter(item => reviewRemainingMs(item.signal.created_at, now) > 0)
  if (visible.length === 0) return null

  return (
    <Card padding="none" className="overflow-hidden border-amber-300 dark:border-amber-800/60">
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/40">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          Awaiting your approval
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
            {visible.length}
          </span>
        </p>
        <button
          type="button"
          onClick={openModal}
          className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          Open review
        </button>
      </div>

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {visible.map(item => {
          const { signal, levels } = item
          const remainingMs = reviewRemainingMs(signal.created_at, now)
          const error = errorBySignal[signal.id]
          const pendingApprove = approvingId === signal.id
          const fallbackText = (() => {
            const pd = signal.parsed_data
            if (pd && typeof pd === 'object' && !Array.isArray(pd)) {
              const instr = (pd as Record<string, unknown>).raw_instruction
              if (typeof instr === 'string' && instr.trim()) return instr
            }
            return null
          })()
          const messageText = signal.raw_message?.trim() || fallbackText || '(no message)'
          return (
            <li key={signal.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-neutral-900 dark:text-neutral-50">
                    {messageText}
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
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {formatReviewRemaining(remainingMs)}
                  </p>
                  {error ? (
                    <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{error}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={pendingApprove}
                    onClick={() => { void approve(signal.id) }}
                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pendingApprove ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={pendingApprove}
                    onClick={() => dismiss(signal.id)}
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
    </Card>
  )
}
