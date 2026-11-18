export interface BacktestWorkerSyncResult {
  messages_scanned: number
  candidates: number
  imported: number
  errors: string[]
}

export async function syncBacktestSignalsViaWorker(
  env: { get: (key: string) => string | undefined },
  userId: string,
  channelIds: string[],
  dateFrom: string,
  dateTo: string,
  opts?: {
    runId?: string
    onChannelStart?: (channelIndex: number, channelId: string) => Promise<void>
  },
): Promise<BacktestWorkerSyncResult> {
  const backtestUrl = (env.get("BACKTEST_WORKER_URL") ?? "").trim().replace(/\/+$/, "")
  const workerUrl = (backtestUrl || (env.get("WORKER_URL") ?? "")).trim().replace(/\/+$/, "")
  const token = (env.get("WORKER_INTERNAL_TOKEN") ?? "").trim()

  if (!workerUrl || !token) {
    return {
      messages_scanned: 0,
      candidates: 0,
      imported: 0,
      errors: ["WORKER_URL not configured — cannot sync Telegram signals"],
    }
  }

  let messagesScanned = 0
  let candidates = 0
  let imported = 0
  const errors: string[] = []

  const syncOne = async (channelRowId: string, index: number): Promise<BacktestWorkerSyncResult> => {
    await opts?.onChannelStart?.(index, channelRowId)
    try {
      const res = await fetch(`${workerUrl}/auth/backtest_sync_signals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": token,
        },
        body: JSON.stringify({
          user_id: userId,
          channel_row_id: channelRowId,
          from: dateFrom,
          to: dateTo,
          run_id: opts?.runId,
        }),
      })
      const data = await res.json().catch(() => ({})) as BacktestWorkerSyncResult & { error?: string }
      if (!res.ok) {
        const raw = (data.error ?? `Telegram sync failed (${res.status})`).trim()
        // Trade / listener-only workers return plain "Not found" for unknown routes.
        let message = raw
        if (raw === "Not found" || (res.status === 404 && /not found/i.test(raw))) {
          message = "Backtest sync URL points at a worker without /auth/backtest_sync_signals "
            + "(trade or wrong role). Set Edge secret BACKTEST_WORKER_URL to a "
            + "WORKER_ROLE=backtest (or all) Railway service — see docs/backtest-setup.md."
        } else if (res.status === 401 || /unauthorized/i.test(raw)) {
          message = "Unauthorized talking to the backtest worker — "
            + "WORKER_INTERNAL_TOKEN on Supabase Edge must exactly match the "
            + "Railway Backtest service (same value as Listener/Trade on Migration)."
        }
        const errors = [message]
        return {
          messages_scanned: 0,
          candidates: 0,
          imported: 0,
          errors,
        }
      }
      return {
        messages_scanned: Number(data.messages_scanned ?? 0),
        candidates: Number(data.candidates ?? 0),
        imported: Number(data.imported ?? 0),
        errors: (data.errors ?? []).filter(Boolean) as string[],
      }
    } catch (e) {
      return {
        messages_scanned: 0,
        candidates: 0,
        imported: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      }
    }
  }

  const concurrency = Math.min(2, Math.max(1, channelIds.length))
  for (let i = 0; i < channelIds.length; i += concurrency) {
    const batch = channelIds.slice(i, i + concurrency)
    const parts = await Promise.all(batch.map((id, j) => syncOne(id, i + j)))
    for (const part of parts) {
      messagesScanned += part.messages_scanned
      candidates += part.candidates
      imported += part.imported
      errors.push(...part.errors)
    }
  }

  return { messages_scanned: messagesScanned, candidates, imported, errors }
}
