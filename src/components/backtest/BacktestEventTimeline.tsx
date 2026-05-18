import clsx from 'clsx'
import type { BacktestTradeRow } from '../../lib/backtestTypes'
import { buildTradeEvents, formatEntryPrice, formatEventTimestamp } from '../../lib/backtestDisplay'

interface BacktestEventTimelineProps {
  trade: BacktestTradeRow
}

export function BacktestEventTimeline({ trade }: BacktestEventTimelineProps) {
  const events = buildTradeEvents(trade)

  if (events.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-4 text-center">
        No timed events recorded for this signal.
      </p>
    )
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-4">
        Event timeline
      </p>
      <ol className="relative border-l border-neutral-200 dark:border-neutral-700 ml-2 space-y-5">
        {events.map((ev, i) => {
          const isSl = ev.type === 'sl'
          const isBe = ev.type === 'be'
          return (
            <li key={`${ev.type}-${ev.level ?? ''}-${ev.at}-${i}`} className="ml-5">
              <span
                className={clsx(
                  'absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-neutral-900',
                  isSl ? 'bg-error-500' : isBe ? 'bg-amber-500' : 'bg-teal-500',
                )}
              />
              <p
                className={clsx(
                  'text-sm font-semibold',
                  isSl ? 'text-error-700 dark:text-error-400' : isBe ? 'text-amber-700' : 'text-teal-700 dark:text-teal-400',
                )}
              >
                {ev.label} → {formatEntryPrice(ev.price)}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5 tabular-nums">
                {formatEventTimestamp(ev.at)}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
