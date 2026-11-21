import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { downloadCsvText } from '../../lib/accountTradesCsvCore'

export type AssistantCsvDownloadCardCopy = {
  title: string
  ready: string
  empty: string
  download: string
  countLabel: string
}

export type AssistantCsvDownloadPayload = {
  filename: string
  day: string
  count: number
  csv: string
}

export function AssistantCsvDownloadCard({
  payload,
  copy,
}: {
  payload: AssistantCsvDownloadPayload
  copy: AssistantCsvDownloadCardCopy
}) {
  const empty = payload.count <= 0
  return (
    <div className="animate-assistant-msg-in ms-9.5 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-900 dark:text-neutral-50">
        {copy.title}
      </p>
      <div className="rounded-xl border border-neutral-200/80 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <p className="text-sm text-neutral-800 dark:text-neutral-100">
          {empty ? copy.empty : copy.ready}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {payload.filename}
          {!empty
            ? ` · ${copy.countLabel.replace('{count}', String(payload.count))}`
            : ''}
        </p>
        {!empty ? (
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => downloadCsvText(payload.csv, payload.filename)}
          >
            <Download className="h-3.5 w-3.5" />
            {copy.download}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
