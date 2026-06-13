import { useCallback, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import clsx from 'clsx'
import { useT } from '../../context/LocaleContext'
import { useUserProfile } from '../../context/UserProfileContext'

interface CopierPauseToggleProps {
  className?: string
}

export function CopierPauseToggle({ className }: CopierPauseToggleProps) {
  const t = useT()
  const cp = t.nav.copierPause
  const { copierPaused, patchProfile, persistProfile, refreshProfile } = useUserProfile()
  const [saving, setSaving] = useState(false)

  const toggle = useCallback(async () => {
    if (saving) return
    const next = !copierPaused
    setSaving(true)
    patchProfile({ copier_paused: next })
    try {
      await persistProfile({ copier_paused: next })
    } catch {
      await refreshProfile()
    } finally {
      setSaving(false)
    }
  }, [copierPaused, patchProfile, persistProfile, refreshProfile, saving])

  const actionLabel = copierPaused ? cp.resumeLabel : cp.pauseLabel
  const statusLabel = copierPaused ? cp.statusStopped : cp.statusRunning

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={saving}
      aria-pressed={copierPaused}
      aria-label={`${statusLabel}. ${actionLabel}`}
      title={copierPaused ? cp.pausedHint : actionLabel}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:gap-2 sm:px-2.5 sm:text-sm',
        copierPaused
          ? 'text-teal-700 bg-teal-50 hover:bg-teal-100 dark:text-teal-300 dark:bg-teal-950/40 dark:hover:bg-teal-950/60'
          : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-neutral-50 dark:hover:bg-neutral-800',
        className,
      )}
    >
      {copierPaused ? (
        <Play className="h-4 w-4 shrink-0 sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden />
      ) : (
        <Pause className="h-4 w-4 shrink-0 sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden />
      )}
      <span className="whitespace-nowrap">{statusLabel}</span>
    </button>
  )
}
