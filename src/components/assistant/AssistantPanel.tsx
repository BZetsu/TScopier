import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Loader2, Send, Sparkles, X } from 'lucide-react'
import { useAssistant } from '../../context/AssistantContext'
import { useAddTradingAccount } from '../../context/AddTradingAccountContext'
import { useLiveChat } from '../../context/LiveChatContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { useBrokerAccounts } from '../../context/BrokerAccountsContext'
import { useAuth } from '../../context/AuthContext'
import { useLocale, useT } from '../../context/LocaleContext'
import {
  executeAssistantAction,
  postAssistantChat,
  type PendingConfirmation,
} from '../../lib/assistantClient'
import {
  ASSISTANT_MAX_IMAGES,
  fileToAssistantImageDataUrl,
  isAssistantImageType,
} from '../../lib/assistantImages'
import { runPendingClientActions } from '../../lib/assistantActions'
import { callTelegramAuth } from '../../lib/telegramAuthApi'
import {
  isNoPendingPhoneAuthError,
  resolveTelegramAuthError,
} from '../../lib/telegramAuthError'
import {
  extractTelegramPhoneFromText,
  looksLikeTelegramOtp,
  normalizeTelegramPhoneInput,
  redactTelegramPhones,
} from '../../lib/telegramPhone'
import { fxsocketBroker } from '../../lib/fxsocketBroker'
import {
  brokerConnectErrorLabelsFromI18n,
  userFacingBrokerConnectError,
} from '../../lib/brokerConnectError'
import { AssistantChatBubble, AssistantTypingIndicator } from './AssistantChatBubble'
import { AssistantTelegramLinkCard } from './AssistantTelegramLinkCard'
import { AssistantBrokerConnectCard } from './AssistantBrokerConnectCard'
import { Button } from '../ui/Button'
import clsx from 'clsx'
import { ensureFreshAuthSession } from '../../lib/fxsocketBroker'

export function AssistantPanel() {
  const t = useT()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { openAddTradingAccount } = useAddTradingAccount()
  const { openLiveChat } = useLiveChat()
  const { refreshProfile } = useUserProfile()
  const { upsertBroker, refreshBrokers } = useBrokerAccounts()
  const {
    open,
    closeAssistant,
    messages,
    persistMessages,
    pendingConfirmations,
    setPendingConfirmations,
    setPendingClientActions,
    telegramLink,
    setTelegramLink,
    startTelegramLinkFlow,
    resetTelegramLinkFlow,
    brokerConnect,
    setBrokerConnect,
    startBrokerConnectFlow,
    resetBrokerConnectFlow,
  } = useAssistant()

  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState('')
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingCodeRef = useRef('')

  const a = t.nav.assistant
  const ce = t.pages.copierEngine
  const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`

  const tgErrorMessages = {
    telegramAlreadyLinked: ce.telegramAlreadyLinked,
    noPendingPhoneAuth: a.telegram.sessionExpired,
  }

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tId = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      document.body.style.overflow = previous
      window.clearTimeout(tId)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [open, messages, pendingConfirmations, sending, draftImages, telegramLink.stage, telegramLink.error, brokerConnect.active, brokerConnect.error])

  if (!open) return null

  const appendAssistantLocal = (content: string) => {
    persistMessages(prev => [...prev, { role: 'assistant', content }])
  }

  const appendUserAndAssistant = (userContent: string, assistantContent: string) => {
    persistMessages(prev => [
      ...prev,
      { role: 'user', content: redactTelegramPhones(userContent) },
      { role: 'assistant', content: assistantContent },
    ])
  }

  const applySideEffects = async (
    clientActions: Parameters<typeof runPendingClientActions>[0],
    confirmations: PendingConfirmation[],
  ) => {
    setPendingConfirmations(confirmations)
    setPendingClientActions(clientActions)
    if (clientActions.length) {
      runPendingClientActions(clientActions, {
        navigate,
        openAddTradingAccount,
        openLiveChat,
        refreshProfile,
        startTelegramLinkFlow,
        startBrokerConnectFlow,
      })
    }
  }

  const resolveAuthToken = async () => {
    try {
      return await ensureFreshAuthSession()
    } catch {
      return session?.access_token
    }
  }

  const handleSendCode = async (phoneRaw: string, opts?: { fromChat?: boolean; chatText?: string }) => {
    const phone = normalizeTelegramPhoneInput(phoneRaw)
    setTelegramLink(prev => ({ ...prev, busy: true, error: '', phone }))
    try {
      const token = await resolveAuthToken()
      const { ok, data } = await callTelegramAuth<{ error?: string }>(EDGE_FN, token, 'send_code', {
        phone,
      })
      if (!ok || data.error) {
        const msg = resolveTelegramAuthError(data.error, ce.failedSendCode, tgErrorMessages)
        setTelegramLink(prev => ({ ...prev, busy: false, error: msg, stage: 'phone', phone }))
        return
      }
      pendingCodeRef.current = ''
      setTelegramLink({
        stage: 'code',
        phone,
        code: '',
        error: '',
        busy: false,
      })
      if (opts?.fromChat) {
        appendUserAndAssistant(opts.chatText || phone, a.telegram.codeSent)
      } else {
        appendAssistantLocal(a.telegram.codeSent)
      }
    } catch {
      setTelegramLink(prev => ({
        ...prev,
        busy: false,
        error: ce.networkError,
        stage: 'phone',
      }))
    }
  }

  const finishLinked = async () => {
    pendingCodeRef.current = ''
    setTelegramLink({
      stage: 'done',
      phone: '',
      code: '',
      error: '',
      busy: false,
    })
    persistMessages(prev => [...prev, { role: 'assistant', content: a.telegram.linkedSuccess }])
    await refreshProfile()
    window.setTimeout(() => {
      setTelegramLink(prev => (prev.stage === 'done' ? { ...prev, stage: 'idle' } : prev))
    }, 400)
  }

  const handleVerifyCode = async (code: string) => {
    const phone = telegramLink.phone
    setTelegramLink(prev => ({ ...prev, busy: true, error: '', code }))
    pendingCodeRef.current = code
    try {
      const token = await resolveAuthToken()
      const { ok, data } = await callTelegramAuth<{
        error?: string
        requires_password?: boolean
      }>(EDGE_FN, token, 'verify_code', { phone, code })
      if (data.requires_password) {
        setTelegramLink({
          stage: 'twoFa',
          phone,
          code,
          error: '',
          busy: false,
        })
        appendAssistantLocal(a.telegram.twoFaNeeded)
        return
      }
      if (!ok || data.error) {
        const msg = resolveTelegramAuthError(data.error, ce.verificationFailed, tgErrorMessages)
        if (isNoPendingPhoneAuthError(data.error)) {
          pendingCodeRef.current = ''
          setTelegramLink({
            stage: 'phone',
            phone: '',
            code: '',
            error: msg,
            busy: false,
          })
        } else {
          setTelegramLink(prev => ({ ...prev, busy: false, error: msg, stage: 'code' }))
        }
        return
      }
      await finishLinked()
    } catch {
      setTelegramLink(prev => ({ ...prev, busy: false, error: ce.networkError }))
    }
  }

  const handleSubmitPassword = async (password: string) => {
    const phone = telegramLink.phone
    const code = telegramLink.code || pendingCodeRef.current
    setTelegramLink(prev => ({ ...prev, busy: true, error: '' }))
    try {
      const token = await resolveAuthToken()
      const { ok, data } = await callTelegramAuth<{ error?: string }>(EDGE_FN, token, 'verify_code', {
        phone,
        code,
        password,
      })
      if (!ok || data.error) {
        const msg = resolveTelegramAuthError(data.error, ce.verificationFailed, tgErrorMessages)
        if (isNoPendingPhoneAuthError(data.error)) {
          pendingCodeRef.current = ''
          setTelegramLink({
            stage: 'phone',
            phone: '',
            code: '',
            error: msg,
            busy: false,
          })
        } else {
          setTelegramLink(prev => ({ ...prev, busy: false, error: msg, stage: 'twoFa' }))
        }
        return
      }
      await finishLinked()
    } catch {
      setTelegramLink(prev => ({ ...prev, busy: false, error: ce.networkError }))
    }
  }

  const handleBrokerConnect = async (values: {
    platform: 'MT4' | 'MT5'
    account_login: string
    broker_server: string
    label: string
    password: string
  }) => {
    setBrokerConnect(prev => ({
      ...prev,
      busy: true,
      error: '',
      platform: values.platform,
      account_login: values.account_login,
      broker_server: values.broker_server,
      label: values.label,
    }))
    try {
      const { account } = await fxsocketBroker.connect({
        platform: values.platform,
        login: values.account_login,
        password: values.password,
        server: values.broker_server,
        label: values.label || undefined,
      })
      upsertBroker(account)
      await refreshBrokers({ silent: true }).catch(() => {})
      resetBrokerConnectFlow()
      persistMessages(prev => [...prev, { role: 'assistant', content: a.broker.connectedSuccess }])
      await refreshProfile()
    } catch (e) {
      const labels = brokerConnectErrorLabelsFromI18n(t.accountConfig.brokerList)
      setBrokerConnect(prev => ({
        ...prev,
        busy: false,
        error: userFacingBrokerConnectError(e, labels),
      }))
    }
  }

  const addImageFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => isAssistantImageType(f.type))
    if (!list.length) {
      setError(a.imageTypeUnsupported)
      return
    }
    const room = ASSISTANT_MAX_IMAGES - draftImages.length
    if (room <= 0) {
      setError(a.imageLimitReached)
      return
    }
    setError('')
    setAttaching(true)
    try {
      const next: string[] = []
      for (const file of list.slice(0, room)) {
        try {
          next.push(await fileToAssistantImageDataUrl(file))
        } catch (e) {
          const code = e instanceof Error ? e.message : ''
          setError(code === 'too_large' ? a.imageTooLarge : a.imageTypeUnsupported)
        }
      }
      if (next.length) setDraftImages(prev => [...prev, ...next].slice(0, ASSISTANT_MAX_IMAGES))
    } finally {
      setAttaching(false)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if ((!text && draftImages.length === 0) || sending || attaching || telegramLink.busy || brokerConnect.busy) return

    // Never send OTP/password free-text to OpenAI while linking.
    if (
      (telegramLink.stage === 'code' || telegramLink.stage === 'twoFa') &&
      text &&
      looksLikeTelegramOtp(text) &&
      draftImages.length === 0
    ) {
      setDraft('')
      setError(a.telegram.useSecureCodeField)
      return
    }

    // Phone typed in chat during phone stage → send_code locally (no LLM).
    if (telegramLink.stage === 'phone' && text && draftImages.length === 0) {
      const phone = extractTelegramPhoneFromText(text)
      if (phone) {
        setDraft('')
        setError('')
        await handleSendCode(phone, { fromChat: true, chatText: text })
        return
      }
    }

    setError('')
    setDraft('')
    const images = draftImages
    setDraftImages([])
    const userContent = text ? redactTelegramPhones(text) : a.imageOnlyCaption
    const nextMessages = [
      ...messages,
      {
        role: 'user' as const,
        content: userContent,
        ...(images.length ? { images } : {}),
      },
    ]
    persistMessages(nextMessages)
    setSending(true)
    try {
      const res = await postAssistantChat({ messages: nextMessages, locale })
      persistMessages([
        ...nextMessages,
        { role: 'assistant', content: res.assistant_message || a.emptyReply },
      ])
      await applySideEffects(res.pending_client_actions, res.pending_confirmations)
    } catch (e) {
      setError(e instanceof Error ? e.message : a.errorFallback)
    } finally {
      setSending(false)
    }
  }

  const onConfirm = async (item: PendingConfirmation) => {
    const key = `${item.tool}:${JSON.stringify(item.args)}`
    setConfirmBusy(key)
    setError('')
    try {
      const res = await executeAssistantAction({ tool: item.tool, args: item.args })
      setPendingConfirmations(prev => prev.filter(p => p !== item))
      if (res.error) {
        setError(res.error)
        persistMessages(prev => [
          ...prev,
          { role: 'assistant', content: res.error || a.errorFallback },
        ])
      } else {
        persistMessages(prev => [
          ...prev,
          { role: 'assistant', content: res.assistant_message || a.actionDone },
        ])
      }
      if (item.tool === 'set_copier_paused') {
        await refreshProfile()
      }
      if (
        item.tool === 'set_broker_active' ||
        item.tool === 'update_channel_config' ||
        item.tool === 'apply_preset' ||
        item.tool === 'save_preset'
      ) {
        await refreshBrokers({ silent: true }).catch(() => {})
      }
      await applySideEffects(res.pending_client_actions, res.pending_confirmations)
    } catch (e) {
      setError(e instanceof Error ? e.message : a.errorFallback)
    } finally {
      setConfirmBusy(null)
    }
  }

  const onCancelConfirm = (item: PendingConfirmation) => {
    setPendingConfirmations(prev => prev.filter(p => p !== item))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (!files.length) return
    e.preventDefault()
    void addImageFiles(files)
  }

  const canSend =
    (draft.trim().length > 0 || draftImages.length > 0) &&
    !sending &&
    !attaching &&
    !telegramLink.busy &&
    !brokerConnect.busy

  const showTelegramCard =
    telegramLink.stage === 'phone' ||
    telegramLink.stage === 'code' ||
    telegramLink.stage === 'twoFa'

  const showBrokerCard = brokerConnect.active

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label={a.title}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label={a.close}
        onClick={closeAssistant}
      />
      <div
        className={clsx(
          'relative flex h-full w-full max-w-md flex-col border-s border-neutral-200 bg-white shadow-2xl',
          'dark:border-neutral-800 dark:bg-neutral-950',
        )}
      >
        <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{a.title}</h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{a.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={closeAssistant}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label={a.close}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={listRef}
          className={clsx(
            'flex-1 space-y-4 overflow-y-auto px-4 py-5',
            'bg-[radial-gradient(ellipse_at_top,_rgba(13,148,136,0.06),_transparent_55%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)]',
            'dark:bg-[radial-gradient(ellipse_at_top,_rgba(13,148,136,0.12),_transparent_50%),linear-gradient(to_bottom,_#020617,_#0f172a)]',
          )}
        >
          {messages.length === 0 && !showTelegramCard && !showBrokerCard && (
            <div className="animate-assistant-msg-in mx-auto max-w-sm pt-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-lg shadow-teal-600/25">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{a.welcomeTitle}</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{a.subtitle}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {a.suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-full border border-neutral-200/90 bg-white/90 px-3 py-1.5 text-start text-xs text-neutral-700 shadow-sm transition hover:border-teal-300 hover:text-teal-800 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:border-teal-700 dark:hover:text-teal-200"
                    onClick={() => setDraft(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <AssistantChatBubble
              key={`${m.role}-${i}`}
              message={m}
              hidePlainCaption={
                Boolean(m.images?.length) && m.content.trim() === a.imageOnlyCaption
              }
            />
          ))}

          {showBrokerCard ? (
            <AssistantBrokerConnectCard
              key={`broker:${brokerConnect.account_login}:${brokerConnect.broker_server}`}
              platform={brokerConnect.platform}
              accountLogin={brokerConnect.account_login}
              brokerServer={brokerConnect.broker_server}
              label={brokerConnect.label}
              error={brokerConnect.error}
              busy={brokerConnect.busy}
              copy={{
                title: a.broker.title,
                hint: a.broker.hint,
                platformLabel: a.broker.platformLabel,
                loginLabel: a.broker.loginLabel,
                serverLabel: a.broker.serverLabel,
                labelLabel: a.broker.labelLabel,
                passwordLabel: a.broker.passwordLabel,
                passwordPlaceholder: a.broker.passwordPlaceholder,
                connect: a.broker.connect,
                cancel: a.cancel,
                openFullForm: a.broker.openFullForm,
                missingFields: a.broker.missingFields,
              }}
              onConnect={values => void handleBrokerConnect(values)}
              onCancel={resetBrokerConnectFlow}
              onOpenFullForm={() => {
                resetBrokerConnectFlow()
                openAddTradingAccount()
              }}
            />
          ) : null}

          {showTelegramCard ? (
            <AssistantTelegramLinkCard
              key={`${telegramLink.stage}:${telegramLink.phone}`}
              stage={telegramLink.stage}
              phone={telegramLink.phone}
              error={telegramLink.error}
              busy={telegramLink.busy}
              copy={{
                phoneTitle: a.telegram.phoneTitle,
                phoneHint: a.telegram.phoneHint,
                phonePlaceholder: a.telegram.phonePlaceholder,
                sendCode: a.telegram.sendCode,
                codeTitle: a.telegram.codeTitle,
                codeHint: a.telegram.codeHint,
                codePlaceholder: a.telegram.codePlaceholder,
                verifyCode: a.telegram.verifyCode,
                twoFaTitle: a.telegram.twoFaTitle,
                twoFaHint: a.telegram.twoFaHint,
                twoFaPlaceholder: a.telegram.twoFaPlaceholder,
                submitPassword: a.telegram.submitPassword,
                cancel: a.cancel,
                restart: a.telegram.restart,
                openQrInstead: a.telegram.openQrInstead,
                invalidPhone: a.telegram.invalidPhone,
              }}
              onSendCode={phone => void handleSendCode(phone)}
              onVerifyCode={code => void handleVerifyCode(code)}
              onSubmitPassword={password => void handleSubmitPassword(password)}
              onCancel={resetTelegramLinkFlow}
              onRestart={startTelegramLinkFlow}
              onOpenQr={() => {
                resetTelegramLinkFlow()
                navigate('/copier-engine')
              }}
            />
          ) : null}

          {pendingConfirmations.map((item, idx) => {
            const key = `${item.tool}:${JSON.stringify(item.args)}`
            const busy = confirmBusy === key
            return (
              <div
                key={`${item.tool}-${idx}`}
                className="animate-assistant-msg-in ms-[2.375rem] rounded-2xl border border-amber-200/90 bg-amber-50/95 p-3.5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40"
              >
                <p className="text-[13.5px] font-medium leading-relaxed text-amber-950 dark:text-amber-50">
                  {item.summary}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onConfirm(item)}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {a.confirm}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onCancelConfirm(item)}
                  >
                    {a.cancel}
                  </Button>
                </div>
              </div>
            )
          })}

          {sending ? <AssistantTypingIndicator label={a.thinking} /> : null}
        </div>

        {error ? (
          <p className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <footer className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          {draftImages.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {draftImages.map((src, idx) => (
                <div key={`${idx}-${src.slice(-12)}`} className="relative h-16 w-16 shrink-0">
                  <img
                    src={src}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-700"
                  />
                  <button
                    type="button"
                    className="absolute -end-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white shadow dark:bg-neutral-100 dark:text-neutral-900"
                    aria-label={a.removeImage}
                    onClick={() => setDraftImages(prev => prev.filter((_, i) => i !== idx))}
                    disabled={sending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={e => {
                const files = e.target.files
                if (files?.length) void addImageFiles(files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="mb-0.5 rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              aria-label={a.attachImage}
              disabled={sending || attaching || draftImages.length >= ASSISTANT_MAX_IMAGES}
              onClick={() => fileInputRef.current?.click()}
            >
              {attaching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
            </button>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={2}
              placeholder={
                telegramLink.stage === 'code'
                  ? a.telegram.composerCodeHint
                  : telegramLink.stage === 'phone'
                    ? a.telegram.composerPhoneHint
                    : a.placeholder
              }
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              disabled={sending || telegramLink.busy || brokerConnect.busy}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={!canSend}
              onClick={() => void send()}
              aria-label={a.send}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
