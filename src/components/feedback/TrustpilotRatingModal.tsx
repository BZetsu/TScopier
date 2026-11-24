import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { Button } from '../ui/Button'
import {
  TRUSTPILOT_EVALUATE_URL,
  markTrustpilotPromptDone,
  shouldShowTrustpilotPrompt,
  snoozeTrustpilotPrompt,
} from '../../lib/trustpilotPromptStorage'

const TRUSTPILOT_GREEN = '#00b67a'
const TRUSTPILOT_GRAY = '#dcdce6'
const STAR_PATH =
  'M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z'

function StarButton({
  filled,
  label,
  onSelect,
}: {
  filled: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <span className="absolute inset-0" style={{ backgroundColor: TRUSTPILOT_GRAY }} aria-hidden />
      {filled ? (
        <span className="absolute inset-0" style={{ backgroundColor: TRUSTPILOT_GREEN }} aria-hidden />
      ) : null}
      <svg viewBox="0 0 24 24" className="relative z-1 h-full w-full p-1.5 text-white" aria-hidden>
        <path fill="currentColor" d={STAR_PATH} />
      </svg>
    </button>
  )
}

/**
 * Dashboard prompt: rate experience → Trustpilot.
 * Rate = never again. Remind later / close = again after 7 days or next login session.
 */
export function TrustpilotRatingModal() {
  const { user } = useAuth()
  const t = useT()
  const copy = t.trustpilotPrompt
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const closeSnooze = () => {
    snoozeTrustpilotPrompt()
    setOpen(false)
  }

  const { onOverlayMouseDown, onOverlayClick } = useOverlayDismiss(
    overlayRef,
    backdropRef,
    closeSnooze,
  )

  useEffect(() => {
    if (!user) return
    if (!shouldShowTrustpilotPrompt()) return
    const timer = window.setTimeout(() => setOpen(true), 2500)
    return () => window.clearTimeout(timer)
  }, [user])

  const handleRate = () => {
    markTrustpilotPromptDone()
    setOpen(false)
    window.open(TRUSTPILOT_EVALUATE_URL, '_blank', 'noopener,noreferrer')
  }

  if (!open) return null

  const modal = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-80 flex items-end sm:items-center justify-center p-4 sm:p-6"
      onMouseDown={onOverlayMouseDown}
      onClick={onOverlayClick}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-neutral-950/50" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trustpilot-rating-title"
        className="relative w-full max-w-md rounded-2xl border border-neutral-200/65 bg-white shadow-2xl dark:border-neutral-800/55 dark:bg-neutral-900 animate-modal-in overflow-hidden"
      >
        <button
          type="button"
          onClick={closeSnooze}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
          aria-label={copy.close}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-6 pt-8 text-center sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
            {copy.eyebrow}
          </p>
          <h2
            id="trustpilot-rating-title"
            className="mt-2 text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50"
          >
            {copy.title}
          </h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{copy.body}</p>

          <div
            className="mt-6 flex items-center justify-center gap-2"
            role="group"
            aria-label={copy.starsAria}
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <StarButton
                key={value}
                filled={rating >= value}
                label={copy.starAria.replace('{n}', String(value))}
                onSelect={() => setRating(value)}
              />
            ))}
          </div>
          {rating > 0 ? (
            <p className={clsx('mt-2 text-xs font-medium text-neutral-500')}>
              {copy.selected.replace('{n}', String(rating))}
            </p>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">{copy.tapStars}</p>
          )}

          <div className="mt-8 flex flex-col gap-2.5">
            <Button type="button" className="w-full" onClick={handleRate}>
              {copy.rateCta}
            </Button>
            <button
              type="button"
              onClick={closeSnooze}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
            >
              {copy.remindLater}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
