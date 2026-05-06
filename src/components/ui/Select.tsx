import { type SelectHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-neutral-700">{label}</label>
        )}
        <select
          ref={ref}
          className={clsx(
            'w-full px-3 py-2 text-sm rounded-lg border bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none',
            error
              ? 'border-error-500 text-neutral-900'
              : 'border-neutral-200 text-neutral-900 hover:border-neutral-300',
            className
          )}
          {...props}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-error-600">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
