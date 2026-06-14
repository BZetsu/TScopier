import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import { useT } from '../../context/LocaleContext'
import { interpolate } from '../../i18n/interpolate'
import { useBrokerAccounts } from '../../context/BrokerAccountsContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { fxsocketBroker } from '../../lib/fxsocketBroker'
import {
  emptyConnectTradingAccountForm,
  type ConnectTradingAccountForm,
} from '../../lib/connectTradingAccountForm'
import { PaywallErrorAlert } from '../billing/PaywallErrorAlert'
import { PasswordInput } from '../auth/PasswordInput'
import { Input } from '../ui/Input'
import { MtCompanyServerPicker } from '../ui/MtCompanyServerPicker'
import { Button } from '../ui/Button'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import type { BrokerAccount } from '../../types/database'

type ConnectTradingAccountModalProps = {
  open: boolean
  onClose: () => void
  onSuccess?: (broker: BrokerAccount) => void
}

type ConnectStep = 0 | 1 | 2

export function ConnectTradingAccountModal({ open, onClose, onSuccess }: ConnectTradingAccountModalProps) {
  const t = useT()
  const cf = t.accountConfig.connectForm
  const bl = t.accountConfig.brokerList
  const pw = t.pricing.paywall
  const { brokers, upsertBroker } = useBrokerAccounts()
  const { hasActiveSubscription, canAddBroker, limits } = useSubscription()
  const overlayRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const connectStartedAtRef = useRef(0)

  const [form, setForm] = useState<ConnectTradingAccountForm>(emptyConnectTradingAccountForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [connectStep, setConnectStep] = useState<ConnectStep>(0)

  const reset = useCallback(() => {
    setForm(emptyConnectTradingAccountForm)
    setError('')
    setSaving(false)
    setConnectStep(0)
  }, [])

  const handleClose = useCallback(() => {
    if (saving) return
    reset()
    onClose()
  }, [onClose, reset, saving])

  const { onOverlayMouseDown, onOverlayClick } = useOverlayDismiss(overlayRef, backdropRef, handleClose)

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, handleClose, saving])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  useEffect(() => {
    if (!saving) return
    connectStartedAtRef.current = Date.now()
    setConnectStep(0)
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - connectStartedAtRef.current
      if (elapsed >= 45_000) setConnectStep(2)
      else if (elapsed >= 12_000) setConnectStep(1)
      else setConnectStep(0)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [saving])

  const setField = useCallback((field: keyof ConnectTradingAccountForm, value: string) => {
    setForm(prev => (prev[field] === value ? prev : { ...prev, [field]: value }))
  }, [])

  const setBrokerServer = useCallback((value: string) => {
    setField('broker_server', value)
  }, [setField])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!hasActiveSubscription) {
      setError(pw.subscriptionRequired)
      return
    }
    if (!canAddBroker()) {
      setError(interpolate(pw.brokerLimit, { limit: String(limits.maxBrokerAccounts) }))
      return
    }
    if (!form.account_number.trim() || !form.broker_server.trim() || !form.account_password) {
      setError(cf.validationRequired)
      return
    }

    setSaving(true)
    const login = form.account_number.trim()
    const server = form.broker_server.trim()
    const duplicate = brokers.find(b => b.account_login === login && b.broker_server === server)
    if (duplicate) {
      setError(bl.duplicateMtLogin)
      setSaving(false)
      return
    }

    try {
      const { account } = await fxsocketBroker.connect({
        login,
        password: form.account_password,
        server,
        label: form.label.trim() || undefined,
      })
      upsertBroker(account)
      reset()
      if (onSuccess) {
        onSuccess(account)
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : cf.connectFailed)
      setSaving(false)
    }
  }

  if (!open) return null

  const title = interpolate(cf.title, { platform: 'MT5' })
  const connectStepMessage = connectStep === 2
    ? cf.connectingStepSlow
    : connectStep === 1
      ? cf.connectingStepTerminal
      : cf.connectingStepLinking

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      onMouseDown={onOverlayMouseDown}
      onClick={onOverlayClick}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm animate-in" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-trading-account-title"
        className="relative flex max-h-[min(92dvh,56rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-modal-in dark:bg-neutral-900"
      >
        <div className="shrink-0 px-6 pb-4 pt-6 sm:px-8 sm:pt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="connect-trading-account-title"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-50"
              >
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              aria-label={t.common.cancel}
              className="shrink-0 rounded-xl p-3 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="mx-6 h-px bg-neutral-100 dark:bg-neutral-800 sm:mx-8" />

        <div className="relative min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          {error ? <PaywallErrorAlert message={error} className="mb-4" /> : null}

          <form onSubmit={handleSubmit} className={clsx('space-y-4', saving && 'pointer-events-none opacity-60')}>
            <Input
              label={cf.accountLabel}
              placeholder={interpolate(cf.accountLabelPlaceholder, {
                platform: 'MT5',
              })}
              value={form.label}
              onChange={event => setField('label', event.target.value)}
            />

            <MtCompanyServerPicker
              platform="MT5"
              value={form.broker_server}
              onChange={setBrokerServer}
              hint={cf.brokerServerHint}
              required
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label={cf.mtLoginLabel}
                placeholder={cf.mtLoginPlaceholder}
                value={form.account_number}
                onChange={event => setField('account_number', event.target.value)}
                required
              />
              <PasswordInput
                label={cf.passwordLabel}
                placeholder={cf.passwordPlaceholder}
                value={form.account_password}
                onChange={event => setField('account_password', event.target.value)}
                hint={cf.passwordHint}
                required
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" loading={saving} size="sm">
                {cf.connectButton}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
                {t.common.cancel}
              </Button>
            </div>
          </form>

          {saving ? (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/90 px-8 text-center dark:bg-neutral-900/90"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-10 w-10 animate-spin text-teal-600 dark:text-teal-400" />
              <div>
                <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                  {cf.connectingTitle}
                </p>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  {connectStepMessage}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
