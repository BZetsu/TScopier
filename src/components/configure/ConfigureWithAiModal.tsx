import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Send, X } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../ui/Button'
import { AssistantMessageContent } from '../assistant/AssistantMessageContent'
import { interpolate } from '../../i18n/interpolate'
import type { ConfigureModalTranslations } from '../../i18n/locales/configureModal/types'
import {
  postConfigureWithAi,
  type ConfigureWithAiChatAction,
  type ConfigureWithAiChatMessage,
  type ConfigureWithAiContext,
  type ConfigureWithAiSignalExample,
  type PendingSettingsPatch,
} from '../../lib/configureWithAiClient'
import { loadConfigureWithAiSamples } from '../../lib/configureWithAiSignalLoad'
import { normalizeSignalSourceKind } from '../../lib/signalSourceMark'
import { sanitizeConfigureAiPatch } from '../../lib/configureWithAiPatch'

export type ConfigureWithAiModalProps = {
  open: boolean
  onClose: () => void
  onApplyPatch: (patch: Record<string, unknown>) => void
  locale: string
  copy: ConfigureModalTranslations['configureWithAi']
  context: Omit<ConfigureWithAiContext, 'signal_examples'>
  /** Optional: kick off channel AI training from parent when examples are empty. */
  onTrainChannel?: () => void
}

type ChatItem = {
  role: 'user' | 'assistant'
  content: string
  /** Show Load / Paste under this bubble (welcome). */
  showActions?: boolean
  /** In-chat option pills (e.g. Apply settings). */
  pills?: ConfigureWithAiChatAction[]
  /** Signal examples embedded in the chat transcript. */
  examples?: ConfigureWithAiSignalExample[]
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  return String(value)
}

function splitPastedSignals(raw: unknown): ConfigureWithAiSignalExample[] {
  const text = asText(raw).trim()
  if (!text) return []
  const chunks = text
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
  const parts = chunks.length > 1 ? chunks : [text]
  return parts.slice(0, 20).map(raw_message => ({
    raw_message,
    label: 'entry',
  }))
}

function exampleLabel(
  label: string | undefined,
  copy: ConfigureModalTranslations['configureWithAi'],
): string {
  const s = asText(label).toLowerCase()
  if (s === 'update') return asText(copy.exampleLabelUpdate, 'Update')
  if (s === 'ignore') return asText(copy.exampleLabelIgnore, 'Ignore')
  return asText(copy.exampleLabelEntry, 'Entry')
}

function toApiMessages(items: ChatItem[]): ConfigureWithAiChatMessage[] {
  return items
    .map(m => {
      const content = asText(m.content)
      if (m.examples?.length) {
        const body = m.examples
          .slice(0, 12)
          .map((ex, i) => {
            const tag = ex.label ? `[${ex.label}]` : ''
            const raw = asText(ex.raw_message)
            return `${i + 1}. ${tag}\n${raw}`.trim()
          })
          .filter(Boolean)
          .join('\n\n')
        return {
          role: m.role,
          content: `${content}\n\n${body}`.trim().slice(0, 8000),
        }
      }
      return { role: m.role, content: content.slice(0, 8000) }
    })
    .filter(m => m.content.trim().length > 0)
}

const DEFAULT_ANALYZE_REQUEST =
  'Here are my signal examples (entry and update/modify/close when present). Please analyze entry style (single price vs range/zone), how the channel sends modify/close management, consider my account size, and give a clear helpful summary of lot size, trade style, targets, and management. Ask me anything you still need, then propose settings when ready.'

export function ConfigureWithAiModal({
  open,
  onClose,
  onApplyPatch,
  locale,
  copy,
  context,
  onTrainChannel,
}: ConfigureWithAiModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollLockRef = useRef<string | null>(null)
  const examplesRef = useRef<ConfigureWithAiSignalExample[]>([])

  const [messages, setMessages] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<PendingSettingsPatch | null>(null)
  const [examples, setExamples] = useState<ConfigureWithAiSignalExample[]>([])
  const [loadingExamples, setLoadingExamples] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const sourceKind = normalizeSignalSourceKind(context.source_kind) ?? 'telegram'
  const isTradingView = sourceKind === 'tradingview'

  const welcome = asText(
    copy?.welcome,
    'How does your signal look like?',
  )
  const analyzeRequest = asText(
    isTradingView ? copy?.analyzeRequestTradingView : copy?.analyzeRequest,
    isTradingView
      ? 'Here is my TradingView alert JSON format. Please analyze the payload shape (entry, SL, TPs), consider my account size, and propose lot size, trade style, targets, and management. Ask me anything you still need, then propose settings when ready.'
      : DEFAULT_ANALYZE_REQUEST,
  )
  const examplesHeading = asText(
    isTradingView ? copy?.examplesHeadingTradingView : copy?.examplesHeading,
    isTradingView ? 'TradingView JSON format' : 'Signal examples',
  )
  const examplesLoadedTpl = asText(copy?.examplesLoaded, 'Loaded {count} signal example(s).')
  const errorFallback = asText(copy?.errorFallback, 'Something went wrong. Please try again.')
  const needChannel = asText(copy?.needChannel, 'Select a channel first to configure with AI.')
  const loadPrimaryLabel = asText(
    isTradingView ? copy?.loadJsonFormat : copy?.loadFromChannel,
    isTradingView ? 'Load JSON format' : 'Load from channel',
  )
  const loadingPrimaryLabel = asText(
    isTradingView ? copy?.loadingJsonFormat : copy?.loadingExamples,
    isTradingView ? 'Loading TradingView JSON format…' : 'Loading signals from this channel…',
  )
  const analyzingLabel = asText(
    isTradingView ? copy?.analyzingJsonFormat : copy?.analyzingExamples,
    isTradingView ? 'Analyzing your TradingView JSON format…' : 'Analyzing your signal format…',
  )
  const examplesEmptyLabel = asText(
    isTradingView ? copy?.examplesEmptyTradingView : copy?.examplesEmpty,
    isTradingView
      ? 'No TradingView alert JSON found yet — paste a sample alert JSON below, or configure the alert template on the channel.'
      : 'No recent signals found on this channel yet — paste a few sample signals below, or wait for new messages.',
  )
  const pastePlaceholder = asText(
    isTradingView ? copy?.pastePlaceholderTradingView : copy?.pastePlaceholder,
    isTradingView
      ? 'Paste one or more TradingView alert JSON payloads…'
      : 'Paste one or more sample channel signals…',
  )

  useEffect(() => {
    examplesRef.current = examples
  }, [examples])

  useEffect(() => {
    if (!open) return
    setMessages([{ role: 'assistant', content: welcome, showActions: true }])
    setDraft('')
    setError('')
    setProposal(null)
    setExamples([])
    examplesRef.current = []
    setPasteOpen(false)
    setPasteText('')
    const tId = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(tId)
  }, [open, welcome, context.channel_id, context.source_kind])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      if (scrollLockRef.current != null) {
        document.body.style.overflow = scrollLockRef.current
        scrollLockRef.current = null
      }
      return
    }
    scrollLockRef.current = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = scrollLockRef.current ?? ''
      scrollLockRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [open, messages, proposal, sending, pasteOpen])

  const runChat = useCallback(
    async (nextItems: ChatItem[], nextExamples: ConfigureWithAiSignalExample[]) => {
      if (!context.channel_id) {
        setError(needChannel)
        return
      }
      setSending(true)
      setError('')
      try {
        const res = await postConfigureWithAi({
          messages: toApiMessages(nextItems),
          locale,
          context: {
            ...context,
            signal_examples: nextExamples,
            pending_settings_patch: proposal,
          },
        })
        if (res.error) setError(res.error)
        const settings = res.pending_settings_patch?.settings
          ? sanitizeConfigureAiPatch(res.pending_settings_patch.settings)
          : {}
        const hasNewProposal = Object.keys(settings).length > 0
        let nextProposal = proposal
        if (hasNewProposal && res.pending_settings_patch) {
          nextProposal = {
            summary: asText(res.pending_settings_patch.summary, 'Settings'),
            rationale: asText(res.pending_settings_patch.rationale),
            warnings: Array.isArray(res.pending_settings_patch.warnings)
              ? res.pending_settings_patch.warnings.map(w => asText(w)).filter(Boolean)
              : [],
            settings,
          }
          setProposal(nextProposal)
        }
        const defaultPills: ConfigureWithAiChatAction[] = [
          {
            id: 'apply_settings',
            label: asText(copy?.applySettings, 'Apply settings'),
          },
          {
            id: 'something_else',
            label: asText(copy?.somethingElsePill, 'Something else'),
          },
        ]
        const pills: ConfigureWithAiChatAction[] =
          nextProposal != null
            ? res.chat_actions?.length
              ? res.chat_actions
              : defaultPills
            : []
        setMessages(prev => [
          ...prev.map(m => ({ ...m, pills: undefined })),
          {
            role: 'assistant',
            content: asText(res.assistant_message, errorFallback),
            pills: pills.length ? pills : undefined,
          },
        ])
      } catch (e) {
        setError(e instanceof Error ? e.message : errorFallback)
      } finally {
        setSending(false)
      }
    },
    [context, copy?.applySettings, copy?.somethingElsePill, errorFallback, locale, needChannel, proposal],
  )

  const ingestExamples = useCallback(
    async (mapped: ConfigureWithAiSignalExample[]) => {
      setExamples(mapped)
      examplesRef.current = mapped
      setPasteOpen(false)

      const heading = interpolate(examplesLoadedTpl, { count: String(mapped.length) })
      const examplesItem: ChatItem = {
        role: 'assistant',
        content: `${examplesHeading} · ${heading}`,
        examples: mapped,
      }
      const analyzeItem: ChatItem = {
        role: 'user',
        content: analyzeRequest,
      }
      const nextItems: ChatItem[] = [
        { role: 'assistant', content: welcome },
        examplesItem,
        analyzeItem,
      ]
      setMessages(nextItems)
      await runChat(nextItems, mapped)
    },
    [analyzeRequest, examplesHeading, examplesLoadedTpl, runChat, welcome, examplesEmptyLabel],
  )

  const loadFromChannel = async () => {
    if (!context.channel_id) {
      setError(needChannel)
      return
    }
    setLoadingExamples(true)
    setError('')
    try {
      const result = await loadConfigureWithAiSamples({
        channelId: context.channel_id,
        sourceKind: context.source_kind,
      })
      const mapped = result.samples
      if (mapped.length === 0) {
        setMessages(prev => [
          ...prev.map(m => ({ ...m, showActions: false })),
          {
            role: 'assistant',
            content: examplesEmptyLabel,
            showActions: true,
          },
        ])
        setPasteOpen(true)
      } else {
        await ingestExamples(mapped)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : errorFallback)
    } finally {
      setLoadingExamples(false)
    }
  }

  const usePaste = async () => {
    const mapped = splitPastedSignals(pasteText)
    if (!mapped.length) return
    setPasteText('')
    await ingestExamples(mapped)
  }

  const send = async () => {
    const text = asText(draft).trim()
    if (!text || sending) return
    if (!context.channel_id) {
      setError(needChannel)
      return
    }
    const nextItems: ChatItem[] = [
      ...messages.map(m => ({ ...m, showActions: false, content: asText(m.content) })),
      { role: 'user', content: text },
    ]
    setMessages(nextItems)
    setDraft('')
    await runChat(nextItems, examplesRef.current)
  }

  const applyProposal = () => {
    if (!proposal) return
    const patch = sanitizeConfigureAiPatch(proposal.settings)
    if (!Object.keys(patch).length) {
      setProposal(null)
      setMessages(prev => prev.map(m => ({ ...m, pills: undefined })))
      return
    }
    onApplyPatch(patch)
    setProposal(null)
    const note = asText(
      copy?.proposalApplied,
      'Applied to the form — click Save in Configure Trading when you’re ready.',
    )
    setMessages(prev => [
      ...prev.map(m => ({ ...m, pills: undefined })),
      { role: 'assistant', content: note },
    ])
  }

  const onSelectPill = (actionId: string) => {
    if (actionId === 'apply_settings') {
      applyProposal()
      return
    }
    if (actionId === 'something_else') {
      setMessages(prev => prev.map(m => ({ ...m, pills: undefined })))
      setDraft('')
      window.setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-110 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
      onMouseDown={e => {
        if (e.target === overlayRef.current) onClose()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={asText(copy?.title, 'Configure with AI')}
        className="flex h-[min(92dvh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <header className="flex items-start gap-3 border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              {asText(copy?.title, 'Configure with AI')}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
              {asText(
                copy?.subtitle,
                'Describe how you want to trade — or load this channel’s signal format for tailored settings.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-label={asText(copy?.close, 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m, i) => (
            <div key={`${m.role}-${i}`} className="space-y-2">
              {asText(m.content) ? (
                <div
                  className={clsx(
                    'max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'ms-auto whitespace-pre-wrap bg-emerald-600 text-white'
                      : 'me-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50',
                  )}
                >
                  {m.role === 'assistant' ? (
                    <AssistantMessageContent text={asText(m.content)} variant="assistant" />
                  ) : (
                    asText(m.content)
                  )}
                </div>
              ) : null}

              {m.examples?.length ? (
                <div className="me-auto max-w-[95%] space-y-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {interpolate(asText(copy?.examplesCount, '{count} example(s)'), {
                      count: String(m.examples.length),
                    })}
                  </p>
                  <ul className="max-h-56 space-y-2 overflow-y-auto">
                    {m.examples.slice(0, 12).map((ex, j) => (
                      <li
                        key={`${j}-${asText(ex.raw_message).slice(0, 24)}`}
                        className="rounded-lg bg-neutral-50 px-2.5 py-2 text-xs text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                      >
                        <span className="mb-1 inline-block rounded-md bg-neutral-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {exampleLabel(ex.label, copy)}
                        </span>
                        <p className="whitespace-pre-wrap leading-relaxed">{asText(ex.raw_message)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {m.showActions ? (
                <div className="me-auto max-w-[95%] space-y-2 ps-0.5">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={loadingExamples || sending || !context.channel_id}
                      onClick={() => void loadFromChannel()}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-800 transition hover:border-emerald-400 hover:text-emerald-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-emerald-500 dark:hover:text-emerald-200',
                        (loadingExamples || sending || !context.channel_id) &&
                          'pointer-events-none opacity-60',
                      )}
                    >
                      {loadingExamples ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {loadPrimaryLabel}
                    </button>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => setPasteOpen(v => !v)}
                      className={clsx(
                        'rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-800 transition hover:border-emerald-400 hover:text-emerald-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-emerald-500 dark:hover:text-emerald-200',
                        sending && 'pointer-events-none opacity-60',
                      )}
                    >
                      {asText(copy?.pasteLabel, 'Paste signal format')}
                    </button>
                  </div>
                  {!isTradingView && onTrainChannel && examples.length === 0 ? (
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
                      {asText(copy?.trainHint)}
                    </p>
                  ) : null}
                  {pasteOpen ? (
                    <div className="space-y-2 rounded-xl border border-neutral-200 p-2 dark:border-neutral-800">
                      <textarea
                        value={pasteText}
                        onChange={e => setPasteText(e.target.value)}
                        rows={4}
                        placeholder={pastePlaceholder}
                        className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void usePaste()}
                          disabled={!asText(pasteText).trim() || sending}
                        >
                          {asText(copy?.usePaste, 'Use pasted signals')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setPasteText('')
                            setPasteOpen(false)
                          }}
                        >
                          {asText(copy?.clearPaste, 'Clear paste')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {m.pills?.length ? (
                <div className="me-auto flex max-w-[95%] flex-col gap-1.5 ps-0.5 pt-1">
                  <div className="flex flex-wrap gap-2">
                    {m.pills.map(pill => (
                      <button
                        key={pill.id}
                        type="button"
                        disabled={sending}
                        onClick={() => onSelectPill(pill.id)}
                        className={clsx(
                          'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                          pill.id === 'apply_settings'
                            ? 'border-emerald-500/80 bg-emerald-600 text-white hover:bg-emerald-500 dark:border-emerald-400/50 dark:bg-emerald-500 dark:text-neutral-950'
                            : 'border-neutral-300 bg-white text-neutral-800 hover:border-emerald-400 hover:text-emerald-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-emerald-500 dark:hover:text-emerald-200',
                          sending && 'pointer-events-none opacity-60',
                        )}
                      >
                        {asText(pill.label)}
                      </button>
                    ))}
                  </div>
                  {m.pills.some(p => p.id === 'apply_settings') ? (
                    <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                      {asText(
                        copy?.applySettingsHint,
                        'This will apply the settings to the configuration.',
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}

          {loadingExamples ? (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {loadingPrimaryLabel}
            </p>
          ) : null}
          {sending ? (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {examples.length > 0 && messages.some(m => m.examples?.length)
                ? analyzingLabel
                : asText(copy?.thinking, 'Thinking…')}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="px-4 pb-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <footer className="shrink-0 border-t border-neutral-200/80 p-3 dark:border-neutral-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              placeholder={asText(copy?.placeholder, 'e.g. Use 0.02 lots, multi-trade with trailing…')}
              disabled={sending}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={sending || !asText(draft).trim()}
              onClick={() => void send()}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {asText(copy?.send, 'Send')}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
