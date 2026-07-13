import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { ConfigTitle } from '../ui/InfoTooltip'
import { interpolate } from '../../i18n/interpolate'
import {
  fetchChannelSignalExamples,
  formatTradeIntentSummary,
  type ChannelSignalExampleLabel,
  type ChannelSignalExampleRow,
} from '../../lib/channelSignalExamples'
import type { ConfigureModalTranslations } from '../../i18n/locales/configureModal/types'

type Props = {
  channelId: string
  labels: ConfigureModalTranslations['aiTraining']
  trainingActive: boolean
  onRetrain?: () => Promise<{ trained: boolean; error?: string }>
}

function labelVariant(label: ChannelSignalExampleLabel): 'success' | 'primary' | 'neutral' {
  if (label === 'entry') return 'success'
  if (label === 'update') return 'primary'
  return 'neutral'
}

function labelText(label: ChannelSignalExampleLabel, labels: ConfigureModalTranslations['aiTraining']): string {
  if (label === 'entry') return labels.exampleLabelEntry
  if (label === 'update') return labels.exampleLabelUpdate
  return labels.exampleLabelIgnore
}

export function ChannelSignalExamplesSection({
  channelId,
  labels,
  trainingActive,
  onRetrain,
}: Props) {
  const [examples, setExamples] = useState<ChannelSignalExampleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [trainFeedback, setTrainFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null)
  const prevTrainingActive = useRef(trainingActive)

  const loadExamples = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await fetchChannelSignalExamples(channelId)
      setExamples(rows)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : labels.signalExamplesLoadError)
      setExamples([])
    } finally {
      setLoading(false)
    }
  }, [channelId, labels.signalExamplesLoadError])

  useEffect(() => {
    void loadExamples()
    setTrainFeedback(null)
  }, [loadExamples])

  useEffect(() => {
    if (prevTrainingActive.current && !trainingActive) {
      void loadExamples()
    }
    prevTrainingActive.current = trainingActive
  }, [trainingActive, loadExamples])

  const handleRetrain = useCallback(async () => {
    if (!onRetrain || trainingActive) return
    setTrainFeedback(null)
    try {
      const result = await onRetrain()
      if (result.error) {
        setTrainFeedback({ variant: 'error', message: result.error })
        return
      }
      if (result.trained) {
        setTrainFeedback({ variant: 'success', message: labels.autoTrainingDone })
        return
      }
      setTrainFeedback({ variant: 'error', message: labels.trainFailed })
    } catch (err) {
      setTrainFeedback({
        variant: 'error',
        message: err instanceof Error ? err.message : labels.trainFailed,
      })
    }
  }, [labels.autoTrainingDone, labels.trainFailed, onRetrain, trainingActive])

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 min-w-0">
          <ConfigTitle variant="semibold" info={labels.signalExamplesHint}>
            {labels.signalExamplesTitle}
          </ConfigTitle>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{labels.signalExamplesIntro}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || trainingActive}
            onClick={() => void loadExamples()}
            className="min-h-[36px]"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            {labels.signalExamplesRefresh}
          </Button>
          {onRetrain ? (
            <Button
              type="button"
              size="sm"
              disabled={trainingActive}
              loading={trainingActive}
              onClick={() => void handleRetrain()}
              className="min-h-[36px]"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {trainingActive ? labels.training : labels.trainButton}
            </Button>
          ) : null}
        </div>
      </div>

      {trainFeedback ? (
        <Alert variant={trainFeedback.variant === 'success' ? 'success' : 'error'} className="text-sm">
          {trainFeedback.message}
        </Alert>
      ) : null}

      {loadError ? (
        <p className="text-sm text-error-600 dark:text-error-400">{loadError}</p>
      ) : null}

      {loading && examples.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{labels.loadingExisting}</p>
      ) : null}

      {!loading && examples.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-800/30 px-4 py-8 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-neutral-300 dark:text-neutral-600" aria-hidden />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{labels.signalExamplesEmpty}</p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{labels.signalExamplesEmptyHint}</p>
          {onRetrain ? (
            <Button
              type="button"
              className="mt-4 min-h-[40px]"
              disabled={trainingActive}
              loading={trainingActive}
              onClick={() => void handleRetrain()}
            >
              {labels.trainButton}
            </Button>
          ) : null}
        </div>
      ) : null}

      {examples.length > 0 ? (
        <>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {interpolate(labels.signalExamplesCount, { count: String(examples.length) })}
          </p>
          <ul className="space-y-3">
            {examples.map(example => {
              const summary = formatTradeIntentSummary(example.intent)
              return (
                <li
                  key={example.id}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 overflow-hidden"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 dark:border-neutral-800 px-3 py-2 bg-neutral-50/80 dark:bg-neutral-800/40">
                    <Badge variant={labelVariant(example.label)} size="sm">
                      {labelText(example.label, labels)}
                    </Badge>
                    {summary ? (
                      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300 truncate max-w-full">
                        {summary}
                      </span>
                    ) : null}
                  </div>
                  <pre className="px-3 py-3 text-sm text-neutral-700 dark:text-neutral-200 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
                    {example.raw_message}
                  </pre>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{labels.multilingualRetrainHint}</p>
        </>
      ) : null}
    </section>
  )
}
