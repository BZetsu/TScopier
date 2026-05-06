import clsx from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'success' | 'warning' | 'error' | 'neutral' | 'primary'
  size?: 'sm' | 'md'
}

export function Badge({ children, variant = 'neutral', size = 'md' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium rounded-full',
        {
          'bg-success-50 text-success-700': variant === 'success',
          'bg-warning-50 text-warning-600': variant === 'warning',
          'bg-error-50 text-error-600': variant === 'error',
          'bg-neutral-100 text-neutral-600': variant === 'neutral',
          'bg-teal-50 text-teal-700': variant === 'primary',
        },
        {
          'text-xs px-2 py-0.5': size === 'sm',
          'text-xs px-2.5 py-1': size === 'md',
        }
      )}
    >
      {children}
    </span>
  )
}
