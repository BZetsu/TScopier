import { useHumanReview } from '../../context/HumanReviewContext'

/** Floating button to reopen the human-review modal when pending reviews exist. */
export function HumanReviewIndicator() {
  const { pending, openModal } = useHumanReview()
  if (pending.length === 0) return null
  return (
    <button
      type="button"
      onClick={openModal}
      className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-amber-600"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-amber-600">
        {pending.length}
      </span>
      Review
    </button>
  )
}
