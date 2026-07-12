import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'

type DirectionalIconProps = {
  icon: LucideIcon
  className?: string
  /** When true, mirror horizontally in RTL (e.g. chevrons, arrows). */
  mirrorInRtl?: boolean
}

/** Lucide icon that respects document text direction. */
export function DirectionalIcon({ icon: Icon, className, mirrorInRtl = true }: DirectionalIconProps) {
  return (
    <Icon
      className={clsx(className, mirrorInRtl && 'rtl:-scale-x-100')}
      aria-hidden
    />
  )
}
