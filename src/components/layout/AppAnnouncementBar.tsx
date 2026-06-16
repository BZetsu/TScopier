import { Megaphone } from 'lucide-react'
import { useAppAnnouncement } from '../../context/AppAnnouncementContext'

/** Teal announcement bar — message from `app_settings.announcement_message`. */
export function AppAnnouncementBar() {
  const { enabled, message } = useAppAnnouncement()

  if (!enabled || !message) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-teal-200 bg-teal-50 px-3 py-2.5 text-center text-sm text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-100 sm:px-6"
    >
      <Megaphone className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
      <p className="min-w-0 font-medium leading-snug">{message}</p>
    </div>
  )
}
