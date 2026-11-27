import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Info, Receipt } from 'lucide-react'
import { useT, useLocale } from '../../context/LocaleContext'
import { LOCALE_DATE_TAGS } from '../../i18n/types'
import { Button } from '../ui/Button'
import {
  fetchBillingHistory,
  formatBillingMoney,
  formatInvoicePeriod,
  type BillingInvoice,
} from '../../lib/billingApi'

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function invoiceStatusLabel(status: string, bt: ReturnType<typeof useT>['pricing']['billing']) {
  const map: Record<string, string> = {
    paid: bt.invoiceStatusPaid,
    draft: bt.invoiceStatusDraft,
    open: bt.invoiceStatusOpen,
    void: bt.invoiceStatusVoid,
    uncollectible: bt.invoiceStatusUncollectible,
  }
  return map[status] ?? status
}

function invoiceStatusClass(status: string): string {
  switch (status) {
    case 'paid':
      return 'bg-teal-50 text-green-500 dark:bg-teal-950/40 dark:text-teal-300'
    case 'draft':
      return 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
    case 'open':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    default:
      return 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
  }
}

export function ReceiptsPanel({ accessToken }: { accessToken: string }) {
  const t = useT()
  const bt = t.pricing.billing
  const { locale } = useLocale()
  const localeTag = LOCALE_DATE_TAGS[locale] ?? 'en-US'

  const [invoicePages, setInvoicePages] = useState<BillingInvoice[][]>([])
  const [invoicePageIndex, setInvoicePageIndex] = useState(0)
  const [invoiceCursors, setInvoiceCursors] = useState<(string | undefined)[]>([undefined])
  const [invoiceHasMore, setInvoiceHasMore] = useState(false)
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoicesError, setInvoicesError] = useState('')
  const invoicePagesRef = useRef(invoicePages)
  invoicePagesRef.current = invoicePages
  const invoiceCursorsRef = useRef(invoiceCursors)
  invoiceCursorsRef.current = invoiceCursors

  useEffect(() => {
    if (!accessToken) {
      setInvoicesLoading(false)
      return
    }
    if (invoicePagesRef.current[invoicePageIndex]) {
      setInvoicesLoading(false)
      return
    }

    let cancelled = false
    setInvoicesLoading(true)
    setInvoicesError('')

    void fetchBillingHistory(accessToken, {
      startingAfter: invoiceCursorsRef.current[invoicePageIndex],
      limit: 8,
    })
      .then((data) => {
        if (cancelled) return
        setInvoiceHasMore(data.hasMore)
        setInvoicePages((prev) => {
          const next = [...prev]
          next[invoicePageIndex] = data.invoices
          return next
        })
        if (data.hasMore && data.invoices.length > 0) {
          const lastId = data.invoices[data.invoices.length - 1].id
          setInvoiceCursors((prev) => {
            const next = [...prev]
            next[invoicePageIndex + 1] = lastId
            return next
          })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setInvoicesError(err instanceof Error ? err.message : bt.loadInvoicesFailed)
      })
      .finally(() => {
        if (!cancelled) setInvoicesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [invoicePageIndex, accessToken, bt.loadInvoicesFailed])

  const currentInvoices = invoicePages[invoicePageIndex] ?? []

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="border-b border-neutral-200/65 px-6 py-4 dark:border-neutral-800/55">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/40">
            <Receipt className="h-4 w-4 text-green-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                {bt.invoices}
              </h2>
              <Info className="h-3.5 w-3.5 text-neutral-900 dark:text-neutral-50" aria-hidden />
            </div>
            <p className="mt-0.5 text-xs text-neutral-900 dark:text-neutral-50">{bt.invoicesHint}</p>
          </div>
        </div>
      </div>

      {invoicesError ? (
        <div className="px-6 py-8 text-sm text-amber-700 dark:text-amber-300">{invoicesError}</div>
      ) : invoicesLoading && currentInvoices.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-neutral-900 dark:text-neutral-50">
          {t.common.loading}
        </div>
      ) : currentInvoices.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-neutral-900 dark:text-neutral-50">
          {bt.noInvoices}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200/65 bg-neutral-50/80 text-left text-xs font-semibold uppercase tracking-wide text-neutral-900 dark:border-neutral-800/55 dark:bg-neutral-900/60 dark:text-neutral-50">
                <th className="px-6 py-3">{bt.invoiceNumber}</th>
                <th className="px-6 py-3">{bt.period}</th>
                <th className="px-6 py-3">{bt.date}</th>
                <th className="px-6 py-3">{bt.amount}</th>
                <th className="px-6 py-3">{bt.status}</th>
                <th className="px-6 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {currentInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-neutral-50/60 dark:hover:bg-neutral-900/40">
                  <td className="px-6 py-4 font-medium text-neutral-900 dark:text-neutral-100">
                    {inv.number ?? inv.id.slice(-8).toUpperCase()}
                  </td>
                  <td className="px-6 py-4 text-neutral-900 dark:text-neutral-50">
                    {formatInvoicePeriod(inv.periodStart, inv.periodEnd, localeTag)}
                  </td>
                  <td className="px-6 py-4 text-neutral-900 dark:text-neutral-50">
                    {formatShortDate(inv.created, localeTag)}
                  </td>
                  <td className="px-6 py-4 font-medium text-neutral-900 dark:text-neutral-100">
                    {formatBillingMoney(inv.amountPaid, inv.currency, localeTag)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                        invoiceStatusClass(inv.status),
                      )}
                    >
                      {invoiceStatusLabel(inv.status, bt)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {inv.pdfUrl || inv.hostedUrl ? (
                      <a
                        href={inv.pdfUrl ?? inv.hostedUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-green-400 hover:text-green-500 dark:text-green-400"
                      >
                        {bt.downloadInvoice}
                      </a>
                    ) : (
                      <span className="text-neutral-900 dark:text-neutral-50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(invoicePageIndex > 0 || invoiceHasMore) && currentInvoices.length > 0 ? (
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200/65 px-6 py-3 dark:border-neutral-800/55">
          <Button
            variant="ghost"
            size="sm"
            disabled={invoicePageIndex === 0 || invoicesLoading}
            onClick={() => setInvoicePageIndex((p) => Math.max(0, p - 1))}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            {bt.back}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              (invoicePageIndex >= invoicePages.length - 1 && !invoiceHasMore) || invoicesLoading
            }
            onClick={() => setInvoicePageIndex((p) => p + 1)}
            className="gap-1"
          >
            {bt.next}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
