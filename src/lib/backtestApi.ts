import { supabase } from './supabase'
import type {
  BacktestEquityRow,
  BacktestRunMode,
  BacktestRunRow,
  BacktestTradeRow,
  SimpleBacktestConfig,
} from './backtestTypes'

/** Load run + trades via RLS (reliable while edge run is in progress or after completion). */
export async function loadBacktestRunFromDb(
  runId: string,
  userId: string,
): Promise<{
  run: BacktestRunRow
  trades: BacktestTradeRow[]
  equity: BacktestEquityRow[]
}> {
  const { data: run, error: runErr } = await supabase
    .from('backtest_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()
  if (runErr) throw new Error(runErr.message)
  if (!run) throw new Error('Run not found')

  const [{ data: trades, error: tradesErr }, { data: equity, error: eqErr }] = await Promise.all([
    supabase.from('backtest_trades').select('*').eq('run_id', runId).order('signal_at'),
    supabase.from('backtest_equity_points').select('*').eq('run_id', runId).order('ts'),
  ])
  if (tradesErr) throw new Error(tradesErr.message)
  if (eqErr) throw new Error(eqErr.message)

  return {
    run: run as BacktestRunRow,
    trades: (trades ?? []) as BacktestTradeRow[],
    equity: (equity ?? []) as BacktestEquityRow[],
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const session = (await supabase.auth.getSession()).data.session
  const token = session?.access_token
  if (!token) throw new Error('Not signed in')

  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/backtest-run`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(
      'Could not reach backtest-run. Deploy the edge function and apply the backtest migration (see docs/backtest-setup.md).',
    )
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).error)
      : text || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export interface BacktestSyncResult {
  messages_scanned: number
  candidates: number
  imported: number
  errors: string[]
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/** Poll DB until the edge worker finishes (backtest-run returns before simulation ends). */
export async function waitForBacktestRunComplete(
  runId: string,
  userId: string,
  options?: {
    intervalMs?: number
    timeoutMs?: number
    onTick?: (payload: { run: BacktestRunRow; trades: BacktestTradeRow[] }) => void
  },
): Promise<{ run: BacktestRunRow; trades: BacktestTradeRow[] }> {
  const intervalMs = options?.intervalMs ?? 1500
  const timeoutMs = options?.timeoutMs ?? 600_000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const payload = await loadBacktestRunFromDb(runId, userId)
    options?.onTick?.({ run: payload.run, trades: payload.trades })
    if (isTerminalRunStatus(payload.run.status)) {
      return { run: payload.run, trades: payload.trades }
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }

  throw new Error('Backtest is taking longer than expected. Open History to view the run when it completes.')
}

export const backtestApi = {
  sync(config: SimpleBacktestConfig): Promise<BacktestSyncResult> {
    return call({ action: 'sync', config })
  },

  async backtestTpsl(config: SimpleBacktestConfig): Promise<{ run_id: string; run_mode: BacktestRunMode }> {
    const data = await call<{ ok?: boolean; run_id?: string; run_mode?: BacktestRunMode }>({
      action: 'backtest_tpsl',
      config,
    })
    const runId = data?.run_id
    if (!runId) throw new Error('Backtest started but no run id was returned from the server.')
    return { run_id: runId, run_mode: data.run_mode ?? 'tpsl' }
  },

  getRun(runId: string): Promise<{
    run: BacktestRunRow
    trades: BacktestTradeRow[]
    equity: BacktestEquityRow[]
  }> {
    return call({ action: 'get', run_id: runId })
  },
}
