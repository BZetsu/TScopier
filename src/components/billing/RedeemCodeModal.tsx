import { useRef, useState } from 'react'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import { interpolate } from '../../i18n/interpolate'
import { redeemRecoveryCode } from '../../lib/redeemRecoveryCode'

interface RedeemCodeModalProps {
  open: boolean
  onClose: () => void
  /** Called when a code is successfully redeemed, so the parent can refresh entitlement. */
  onRedeemed?: () => void
}

/** Modal where a user enters a one-time recovery code for a usage extension. */
export function RedeemCodeModal({
  open,
  onClose,
  onRedeemed,
}: RedeemCodeModalProps) {
  const t = useT()
  const bt = t.pricing.billing
  const { session } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [redeemed, setRedeemed] = useState(false)
  const [grantedDays, setGrantedDays] = useState(0)

  const overlayRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { onOverlayMouseDown, onOverlayClick } = useOverlayDismiss(
    overlayRef,
    backdropRef,
    onClose,
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim() || loading || redeemed) return
    setLoading(true)
    setError(null)
    try {
      const accessToken = session?.access_token
      if (!accessToken) throw new Error('Not signed in')
      const result = await redeemRecoveryCode(accessToken, code.trim())
      setGrantedDays(result.days)
      setRedeemed(true)
      onRedeemed?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : bt.redeemError)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-120 flex items-end sm:items-center justify-center p-4 sm:p-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onMouseDown={onOverlayMouseDown}
      onClick={onOverlayClick}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-neutral-950/55" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="redeem-code-dialog-title"
        aria-describedby="redeem-code-dialog-body"
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200/65 dark:border-neutral-800/55 animate-modal-in overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
              <svg className="h-5 w-5" aria-hidden fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="redeem-code-dialog-title"
                className="text-base font-semibold text-neutral-900 dark:text-neutral-50"
              >
                {bt.redeemTitle}
              </h2>
              <p
                id="redeem-code-dialog-body"
                className="mt-1.5 text-sm text-neutral-900 dark:text-neutral-50 leading-relaxed"
              >
                {bt.redeemSubtitle}
              </p>
            </div>
          </div>

          {redeemed ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm text-green-700 dark:text-green-400">
                {interpolate(bt.redeemSuccess, { days: grantedDays })}
              </p>
              <Button type="button" variant="primary" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          ) : (
            <>
              {error ? (
                <p className="mt-3 text-xs text-error-600 dark:text-error-300">
                  {error}
                </p>
              ) : null}
              <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
                <Input
                  label={bt.redeemCodeLabel}
                  placeholder={bt.redeemCodePlaceholder}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={loading}
                  disabled={loading || !code.trim()}
                >
                  {bt.redeemButton}
                </Button>
              </form>
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Codes are single-use. If you did not receive a code, contact
                support.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 text-xs underline text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {t.common.cancel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
