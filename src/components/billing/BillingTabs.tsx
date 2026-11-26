import clsx from 'clsx'
import { CreditCard, Crown, Receipt } from 'lucide-react'

export type BillingTabId = 'subscription' | 'payment_methods' | 'receipts'

const TABS: { id: BillingTabId; icon: typeof Crown }[] = [
  { id: 'subscription', icon: Crown },
  { id: 'payment_methods', icon: CreditCard },
  { id: 'receipts', icon: Receipt },
]

export function BillingTabs({
  active,
  onChange,
  labels,
}: {
  active: BillingTabId
  onChange: (id: BillingTabId) => void
  labels: Record<BillingTabId, string>
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-900">
      {TABS.map(({ id, icon: Icon }) => {
        const selected = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors',
              selected
                ? 'bg-neutral-950 text-white dark:bg-neutral-100 dark:text-neutral-950'
                : 'text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-neutral-50',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {labels[id]}
          </button>
        )
      })}
    </div>
  )
}
