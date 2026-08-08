import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { useAssistant } from '../../context/AssistantContext'
import { useAddTradingAccount } from '../../context/AddTradingAccountContext'
import { useLiveChat } from '../../context/LiveChatContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { useLocale, useT } from '../../context/LocaleContext'
import {
  executeAssistantAction,
  postAssistantChat,
  type PendingConfirmation,
} from '../../lib/assistantClient'
import { runPendingClientActions } from '../../lib/assistantActions'
import { Button } from '../ui/Button'
import clsx from 'clsx'

export function AssistantPanel() {
  const t = useT()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const { openAddTradingAccount } = useAddTradingAccount()
  const { openLiveChat } = useLiveChat()
  const { refreshProfile } = useUserProfile()
  const {
    open,
    closeAssistant,
    messages,
    persistMessages,
    pendingConfirmations,
    setPendingConfirmations,
    setPendingClientActions,
  } = useAssistant()

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const a = t.nav.assistant

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
  }, [open, messages, pendingConfirmations, sending])

  if (!open) return null

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
      })
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setError('')
    setDraft('')
    const nextMessages = [...messages, { role: 'user' as const, content: text }]
    persistMessages(nextMessages)
    setSending(true)
    try {
      const res = await postAssistantChat({ messages: nextMessages, locale })
      persistMessages([
        ...nextMessages,
        { role: 'assistant', content: res.assistant_message || a.emptyReply },
      ])
      await applySideEffects(res.pending_client_actions, res.pending_confirmations)
      if (res.pending_confirmations.length === 0) {
        // Mutation tools may have run only as proposals; profile refresh if needed later.
      }
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
      persistMessages([
        ...messages,
        { role: 'assistant', content: res.assistant_message || a.actionDone },
      ])
      if (item.tool === 'set_copier_paused') {
        await refreshProfile()
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

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-300">
              <p className="font-medium text-neutral-800 dark:text-neutral-100">{a.welcomeTitle}</p>
              <ul className="mt-2 list-disc space-y-1 ps-4 text-xs">
                {a.suggestions.map(s => (
                  <li key={s}>
                    <button
                      type="button"
                      className="text-start text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                      onClick={() => setDraft(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={clsx(
                'max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user'
                  ? 'ms-auto bg-teal-600 text-white'
                  : 'me-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100',
              )}
            >
              {m.content}
            </div>
          ))}

          {pendingConfirmations.map((item, idx) => {
            const key = `${item.tool}:${JSON.stringify(item.args)}`
            const busy = confirmBusy === key
            return (
              <div
                key={`${item.tool}-${idx}`}
                className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30"
              >
                <p className="text-sm font-medium text-amber-950 dark:text-amber-100">{item.summary}</p>
                <div className="mt-2 flex gap-2">
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

          {sending && (
            <div className="me-auto flex items-center gap-2 rounded-2xl bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-900">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {a.thinking}
            </div>
          )}
        </div>

        {error ? (
          <p className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <footer className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={a.placeholder}
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              disabled={sending}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={sending || !draft.trim()}
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
